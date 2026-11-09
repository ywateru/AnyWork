import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const rejected = () => new Error("Private browser state rejected.");
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) =>
  same(a, b) &&
  a.mode === b.mode &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
const contains = (root, path) => {
  const child = relative(root, path);
  return (
    child === "" ||
    (child !== ".." && !child.startsWith("../") && !isAbsolute(child))
  );
};
const privateFile = (stat) =>
  stat.isFile() && (stat.mode & 0o7177) === 0 && stat.uid === process.getuid();
const validState = (value) =>
  value &&
  typeof value === "object" &&
  Array.isArray(value.cookies) &&
  Array.isArray(value.origins);

async function repositoryRoots() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { stdout } = await promisify(execFile)(
    "git",
    ["-C", root, "worktree", "list", "--porcelain", "-z"],
    { maxBuffer: 1024 * 1024 },
  );
  const roots = stdout
    .split("\0")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice(9));
  if (!roots.length) throw rejected();
  return Promise.all(roots.map((path) => realpath(path)));
}

/** A single-owner credential lease. Never pass the credential path to Playwright. */
export async function openPrivateBrowserState(path, roots) {
  let lock, lockStat, temporary, temporaryStat;
  let ancestors = [];
  const checkAncestors = async () => {
    for (const [directory, original] of ancestors) {
      const current = await lstat(directory);
      if (
        !current.isDirectory() ||
        !same(current, original) ||
        current.mode !== original.mode ||
        current.uid !== original.uid
      )
        throw rejected();
    }
  };
  const release = async () => {
    try {
      if (lock) {
        await checkAncestors();
        if (!same(await lstat(lock), lockStat)) throw rejected();
        await unlink(lock);
        lock = undefined;
      }
    } catch {
      throw rejected();
    }
  };
  try {
    if (
      typeof path !== "string" ||
      !isAbsolute(path) ||
      resolve(path) !== path ||
      process.platform === "win32"
    )
      throw rejected();
    roots ??= await repositoryRoots();
    if (roots.some((root) => contains(root, path))) throw rejected();
    const directory = dirname(path);
    let cursor = parse(directory).root;
    for (const part of relative(cursor, directory).split("/")) {
      if (part) cursor = join(cursor, part);
      const stat = await lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw rejected();
      ancestors.push([cursor, stat]);
    }
    const parent = ancestors.at(-1)[1];
    if ((parent.mode & 0o022) !== 0 || parent.uid !== process.getuid())
      throw rejected();
    let original = await lstat(path);
    if (!privateFile(original)) throw rejected();
    const lockPath = path + ".lock";
    const handle = await open(lockPath, "wx", 0o600);
    try {
      lockStat = await handle.stat();
      lock = lockPath;
    } finally {
      await handle.close();
    }
    await checkAncestors();
    const input = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let value;
    try {
      const current = await input.stat();
      if (!unchanged(current, original) || current.size > 8 * 1024 * 1024)
        throw rejected();
      value = JSON.parse(await input.readFile("utf8"));
      if (!unchanged(await input.stat(), original) || !validState(value))
        throw rejected();
    } finally {
      await input.close();
    }
    await checkAncestors();
    if (!unchanged(await lstat(path), original)) throw rejected();
    return {
      value,
      async checkpoint(value) {
        try {
          if (!lock || !validState(value)) throw rejected();
          const data = JSON.stringify(value);
          if (Buffer.byteLength(data) > 8 * 1024 * 1024) throw rejected();
          await checkAncestors();
          if (!unchanged(await lstat(path), original)) throw rejected();
          temporary = join(directory, ".anywork-state-" + randomUUID());
          const output = await open(temporary, "wx", 0o600);
          let next;
          try {
            temporaryStat = await output.stat();
            await output.chmod(0o600);
            await output.writeFile(data, "utf8");
            await output.sync();
            next = await output.stat();
          } finally {
            await output.close();
          }
          await checkAncestors();
          if (
            !unchanged(await lstat(path), original) ||
            !same(await lstat(temporary), next)
          )
            throw rejected();
          await rename(temporary, path);
          temporary = undefined;
          temporaryStat = undefined;
          original = await lstat(path);
          if (!same(original, next) || !privateFile(original)) throw rejected();
          const parentHandle = await open(directory, constants.O_RDONLY);
          try {
            await parentHandle.sync();
          } finally {
            await parentHandle.close();
          }
        } catch {
          throw new Error("Private browser state checkpoint failed.");
        } finally {
          if (temporary) {
            try {
              await checkAncestors();
              if (
                !temporaryStat ||
                !same(await lstat(temporary), temporaryStat)
              )
                throw rejected();
              await unlink(temporary);
              temporary = undefined;
              temporaryStat = undefined;
            } catch {
              throw new Error("Private browser state checkpoint failed.");
            }
          }
        }
      },
      release,
    };
  } catch {
    await release();
    throw rejected();
  }
}

/** Preserve this context's rotated state even when later UI assertions fail. */
export async function withPrivateBrowserState({ path, roots, launch, check }) {
  const state = await openPrivateBrowserState(path, roots);
  let browser, context, failure;
  try {
    browser = await launch();
    context = await browser.newContext({
      storageState: state.value,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    });
    await check(context);
  } catch {
    failure = new Error("Cloud account check failed.");
  } finally {
    if (context) {
      try {
        await state.checkpoint(await context.storageState());
      } catch {
        failure = new Error("Private browser state checkpoint failed.");
      }
    }
    try {
      await browser?.close();
    } catch {
      failure ??= new Error("Cloud account check failed.");
    }
    try {
      await state.release();
    } catch {
      failure = rejected();
    }
  }
  if (failure) throw failure;
}
