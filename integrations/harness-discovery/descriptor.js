import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { setTimeout } from "node:timers/promises";

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const ownerId =
  typeof process.getuid === "function" ? process.getuid() : undefined;

function owned(stat) {
  return ownerId === undefined || stat.uid === ownerId;
}

async function optionalStat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Harness discovery received an invalid host URL");
  }
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !loopback ||
    url.username ||
    url.password ||
    !url.searchParams.get("token")
  ) {
    throw new Error(
      "Harness discovery requires an authenticated loopback HTTP(S) host",
    );
  }
  return url.href;
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || !owned(info)) {
    throw new Error(
      "Harness discovery directory must be an owned directory, not a symlink",
    );
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(
      "Harness discovery requires a private parent directory (0700); choose a dedicated directory, not a shared folder",
    );
  }
}

async function validateTarget(path) {
  const info = await optionalStat(path);
  if (info && (!info.isFile() || info.isSymbolicLink() || !owned(info))) {
    throw new Error(
      "Harness discovery target must be an owned regular file, not a symlink",
    );
  }
}

// Every publisher and disposer cooperates through an exclusive owner-only file.
// Never break another host's lock; a killed process's stale transaction fails
// safely with an actionable message rather than risking deletion of a successor.
async function transaction(path, work) {
  const parent = await lstat(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    !owned(parent) ||
    (process.platform !== "win32" && (parent.mode & 0o077) !== 0)
  ) {
    throw new Error(
      "Harness discovery transaction requires its original private directory",
    );
  }
  const lockPath = `${path}.lock`;
  let lock;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      lock = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600,
      );
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await optionalStat(lockPath);
      if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink() || !owned(info))
        throw new Error("Unsafe Harness discovery lock target");
      await setTimeout(50);
    }
  }
  if (!lock)
    throw new Error(
      "Harness discovery transaction is busy. If all Harness hosts are stopped, remove the stale host.json.lock beside the descriptor and retry.",
    );
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
    return await work();
  } finally {
    await lock.close();
    await unlink(lockPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function publishDescriptor(path, authenticatedUrl) {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    basename(path) === "." ||
    dirname(path) === path
  ) {
    throw new Error(
      "Harness discovery requires an absolute descriptor file path",
    );
  }
  const url = validateUrl(authenticatedUrl);
  const parent = dirname(path);
  await privateDirectory(parent);
  const instanceId = randomUUID();
  const descriptor = { version: 1, url, pid: process.pid, instanceId };
  await transaction(path, async () => {
    await validateTarget(path);
    const temporary = join(parent, `.${basename(path)}.${instanceId}.tmp`);
    let file;
    try {
      file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600,
      );
      await file.writeFile(`${JSON.stringify(descriptor)}\n`);
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporary, path);
    } finally {
      await file?.close();
      await unlink(temporary).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  });
  let disposed = false;
  return async () => {
    if (disposed || !(await optionalStat(parent))) return;
    await transaction(path, async () => {
      const info = await optionalStat(path);
      if (!info || !info.isFile() || info.isSymbolicLink() || !owned(info))
        return;
      const file = await open(path, constants.O_RDONLY | NOFOLLOW);
      let current;
      try {
        current = JSON.parse(await file.readFile("utf8"));
      } catch {
        return;
      } finally {
        await file.close();
      }
      // A newer activation's address remains intact, including across processes.
      if (current.instanceId === instanceId) await unlink(path);
    });
    disposed = true;
  };
}
