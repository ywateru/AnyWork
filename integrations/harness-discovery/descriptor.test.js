import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readFile,
  lstat,
  mkdir,
  symlink,
  rm,
  writeFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { publishDescriptor } from "./descriptor.js";
import { apply, inject } from "./index.js";

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), "anywork-harness-discovery-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, path: join(root, "private", "host.json") };
}
const host = "http://127.0.0.1:9387/?token=test-host-only";

test("publishes private atomic descriptor and removes only its activation", async (t) => {
  const { path, root } = await sandbox(t);
  const dispose = await publishDescriptor(path, host);
  const descriptor = JSON.parse(await readFile(path, "utf8"));
  assert.equal(descriptor.version, 1);
  assert.equal(descriptor.url, host);
  assert.equal(descriptor.pid, process.pid);
  assert.match(descriptor.instanceId, /^[a-f0-9-]{36}$/);
  if (process.platform !== "win32") {
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(root, "private"))).mode & 0o777, 0o700);
  }
  assert.deepEqual(await readdir(join(root, "private")), ["host.json"]);
  await dispose();
  await dispose();
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("concurrent activations and old disposers preserve the newest address", async (t) => {
  const { path } = await sandbox(t);
  const disposers = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      publishDescriptor(path, `http://127.0.0.1:9387/?token=activation-${i}`),
    ),
  );
  const final = JSON.parse(await readFile(path, "utf8"));
  const finalIndex = Number(
    new URL(final.url).searchParams.get("token").split("-")[1],
  );
  await Promise.all(
    disposers.filter((_, i) => i !== finalIndex).map((dispose) => dispose()),
  );
  assert.equal(
    JSON.parse(await readFile(path, "utf8")).instanceId,
    final.instanceId,
  );
  await disposers[finalIndex]();
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("publication rejects unauthenticated and non-loopback URLs without leaking secrets", async (t) => {
  const { path } = await sandbox(t);
  for (const url of [
    "https://example.com/?token=secret",
    "http://0.0.0.0/?token=secret",
    "http://192.168.1.2/?token=secret",
    "file:///tmp/?token=secret",
    "http://localhost/",
    "http://user:secret@localhost/?token=secret",
    "invalid-secret",
  ]) {
    await assert.rejects(
      publishDescriptor(path, url),
      (error) => !error.message.includes("secret"),
    );
  }
  await assert.rejects(publishDescriptor("relative.json", host), /absolute/);
  for (const url of [
    "https://localhost/?token=valid",
    "http://[::1]:9387/?token=valid",
  ]) {
    await (
      await publishDescriptor(path, url)
    )();
  }
});

test("file and direct parent symlinks cannot overwrite their targets", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows symlink creation needs OS developer privileges");
    return;
  }
  const { path, root } = await sandbox(t);
  await mkdir(join(root, "private"), { mode: 0o700 });
  const victim = join(root, "victim");
  await writeFile(victim, "do not change");
  await symlink(victim, path);
  await assert.rejects(publishDescriptor(path, host), /symlink/);
  assert.equal(await readFile(victim, "utf8"), "do not change");
  await rm(path);
  const directory = join(root, "symlink-dir");
  await symlink(join(root, "private"), directory);
  await assert.rejects(
    publishDescriptor(join(directory, "host.json"), host),
    /symlink/,
  );
  assert.deepEqual(await readdir(join(root, "private")), []);
});

test("cleanup does not follow replacements or remove malformed foreign descriptors", async (t) => {
  const { path, root } = await sandbox(t);
  const dispose = await publishDescriptor(path, host);
  await writeFile(path, "not our descriptor");
  await dispose();
  assert.equal(await readFile(path, "utf8"), "not our descriptor");
  const dispose2 = await publishDescriptor(path, host);
  const victim = join(root, "victim");
  await writeFile(victim, "safe");
  await rm(path);
  if (process.platform !== "win32") {
    await symlink(victim, path);
    await dispose2();
    assert.equal(await readFile(victim, "utf8"), "safe");
    assert.equal((await lstat(path)).isSymbolicLink(), true);
  }
});

test("cross-process publication and old-host disposal cannot delete successor", async (t) => {
  const { path } = await sandbox(t);
  const old = await publishDescriptor(path, host);
  const childCode = `import {publishDescriptor} from ${JSON.stringify(new URL("./descriptor.js", import.meta.url).href)}; await publishDescriptor(process.argv[1], 'http://127.0.0.1:9387/?token=successor');`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", childCode, path],
    { stdio: "pipe" },
  );
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  assert.equal(code, 0);
  await old();
  assert.equal(
    new URL(JSON.parse(await readFile(path, "utf8")).url).searchParams.get(
      "token",
    ),
    "successor",
  );
});

test("official plugin service injection only reads existing services, effect owns disposal", async (t) => {
  const { path } = await sandbox(t);
  assert.deepEqual(inject, ["webServer", "connection"]);
  let cleanup;
  let calls = 0;
  await apply(
    {
      webServer: {
        getOrigin: () => {
          calls++;
          return "http://127.0.0.1:9387";
        },
      },
      connection: {
        authenticatedUrl: (origin) => `${origin}/?token=existing-host`,
      },
      effect: async (create) => {
        cleanup = await create();
      },
    },
    { descriptorPath: path },
  );
  assert.equal(calls, 1);
  assert.equal(
    new URL(JSON.parse(await readFile(path, "utf8")).url).searchParams.get(
      "token",
    ),
    "existing-host",
  );
  await cleanup();
  await assert.rejects(readFile(path), { code: "ENOENT" });
});

test("existing shared directories are rejected without chmod or content mutation", async (t) => {
  if (process.platform === "win32") {
    t.skip("Unix mode contract");
    return;
  }
  const { root } = await sandbox(t);
  const shared = join(root, "shared");
  await mkdir(shared, { mode: 0o755 });
  const before = (await lstat(shared)).mode;
  await assert.rejects(
    publishDescriptor(join(shared, "host.json"), host),
    /private parent/,
  );
  assert.equal((await lstat(shared)).mode, before);
  assert.deepEqual(await readdir(shared), []);
});
