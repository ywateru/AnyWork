import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { watch } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  openPrivateBrowserState,
  withPrivateBrowserState,
} from "./private-browser-state.mjs";

const fakeState = (token = "fake-initial-refresh") => ({
  cookies: [],
  origins: [
    {
      origin: "https://example.invalid",
      localStorage: [{ name: "fake-sdk-refresh", value: token }],
    },
  ],
});
async function fixture(t) {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), "anywork-state-test-"),
  );
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.json");
  await writeFile(path, JSON.stringify(fakeState()), { mode: 0o600 });
  const roots = [join(directory, "repo"), join(directory, "other-worktree")];
  await Promise.all(roots.map((root) => mkdir(root, { mode: 0o700 })));
  return { directory, path, roots };
}
const read = async (path) => JSON.parse(await readFile(path, "utf8"));

test("rejects relative, every repository root, public file and unsafe directory before launch", async (t) => {
  const { path, roots, directory } = await fixture(t);
  for (const candidate of [
    "relative-state.json",
    ...roots.map((root) => join(root, "public", "state.json")),
  ])
    await assert.rejects(openPrivateBrowserState(candidate, roots), {
      message: "Private browser state rejected.",
    });
  await chmod(path, 0o644);
  await assert.rejects(openPrivateBrowserState(path, roots));
  await chmod(path, 0o600);
  await chmod(directory, 0o777);
  await assert.rejects(openPrivateBrowserState(path, roots));
  await chmod(directory, 0o700);
  let launched = false;
  await assert.rejects(
    withPrivateBrowserState({
      path: "unsafe-relative",
      roots,
      launch: () => {
        launched = true;
      },
    }),
  );
  assert.equal(launched, false);
});

test("rejects leaf symlinks, ancestor symlinks and nonregular files", async (t) => {
  const { path, directory, roots } = await fixture(t);
  const link = join(directory, "link.json");
  await symlink(path, link);
  await assert.rejects(openPrivateBrowserState(link, roots));
  const actual = join(directory, "actual");
  await mkdir(actual, { mode: 0o700 });
  await writeFile(join(actual, "state.json"), JSON.stringify(fakeState()), {
    mode: 0o600,
  });
  const alias = join(directory, "alias");
  await symlink(actual, alias);
  await assert.rejects(
    openPrivateBrowserState(join(alias, "state.json"), roots),
  );
  await assert.rejects(openPrivateBrowserState(actual, roots));
});

test("accepts stricter owner-only input, locks its owner, replaces atomically with private temporary and final files", async (t) => {
  const { path, directory, roots } = await fixture(t);
  await chmod(path, 0o400);
  const before = await lstat(path);
  const lease = await openPrivateBrowserState(path, roots);
  await assert.rejects(openPrivateBrowserState(path, roots));
  const observed = [];
  const pending = [];
  const watcher = watch(directory, (_event, name) => {
    if (name?.startsWith(".anywork-state-"))
      pending.push(
        lstat(join(directory, name)).then(
          (stat) => observed.push(stat.mode & 0o777),
          () => {},
        ),
      );
  });
  try {
    const next = fakeState("fake-rotated-" + "x".repeat(1024 * 1024));
    await lease.checkpoint(next);
    await Promise.all(pending);
    assert.deepEqual(await read(path), next);
    const after = await lstat(path);
    assert.notEqual(after.ino, before.ino);
    assert.equal(after.mode & 0o777, 0o600);
    assert.ok(observed.length > 0);
    assert.ok(observed.every((mode) => mode === 0o600));
  } finally {
    watcher.close();
    await lease.release();
  }
  assert.deepEqual((await readdir(directory)).sort(), [
    "other-worktree",
    "repo",
    "state.json",
  ]);
});

test("assertion failure after simulated refresh persists the same owner's rotated state and remains a sanitized failure", async (t) => {
  const { path, roots } = await fixture(t);
  const rotated = fakeState("fake-rotated-on-failed-check");
  let closed = false,
    contextState;
  await assert.rejects(
    withPrivateBrowserState({
      path,
      roots,
      launch: async () => ({
        newContext: async (options) => {
          contextState = options.storageState;
          assert.equal(typeof contextState, "object");
          return { storageState: async () => rotated };
        },
        close: async () => {
          closed = true;
        },
      }),
      check: async () => {
        throw new Error("fake-secret-browser-error-123");
      },
    }),
    { message: "Cloud account check failed." },
  );
  assert.deepEqual(contextState, fakeState());
  assert.deepEqual(await read(path), rotated);
  assert.equal(closed, true);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
});

test("changed destination identity or symlink is rejected without replacing it or its target", async (t) => {
  const { path, directory, roots } = await fixture(t);
  const lease = await openPrivateBrowserState(path, roots);
  const original = join(directory, "original.json");
  const target = join(directory, "target.json");
  await writeFile(target, "fake-target-preserve", { mode: 0o600 });
  await rename(path, original);
  await symlink(target, path);
  await assert.rejects(lease.checkpoint(fakeState("fake-new")), {
    message: "Private browser state checkpoint failed.",
  });
  assert.equal(await readFile(target, "utf8"), "fake-target-preserve");
  assert.equal((await lstat(path)).isSymbolicLink(), true);
  await lease.release();
});

test("changed parent traversal is refused and no credential is written through replacement", async (t) => {
  const { path, directory, roots } = await fixture(t);
  const privateDir = join(directory, "private");
  await mkdir(privateDir, { mode: 0o700 });
  const child = join(privateDir, "state.json");
  await rename(path, child);
  const lease = await openPrivateBrowserState(child, roots);
  const moved = join(directory, "moved");
  await rename(privateDir, moved);
  await symlink(moved, privateDir);
  await assert.rejects(lease.checkpoint(fakeState("fake-new")));
  await assert.rejects(lease.release());
  assert.deepEqual(await read(join(moved, "state.json")), fakeState());
});

test("parsing, browser and checkpoint errors expose only fixed safe errors", async (t) => {
  const { path, roots } = await fixture(t);
  await writeFile(path, "fake-secret-invalid-json-456");
  await assert.rejects(openPrivateBrowserState(path, roots), {
    message: "Private browser state rejected.",
  });
  await writeFile(path, JSON.stringify(fakeState()));
  await assert.rejects(
    withPrivateBrowserState({
      path,
      roots,
      launch: async () => {
        throw new Error("fake-secret-launch-error-789");
      },
    }),
    { message: "Cloud account check failed." },
  );
  let closed = false;
  await assert.rejects(
    withPrivateBrowserState({
      path,
      roots,
      launch: async () => ({
        newContext: async () => ({
          storageState: async () => {
            throw new Error("fake-secret-checkpoint-error");
          },
        }),
        close: async () => {
          closed = true;
        },
      }),
      check: async () => {},
    }),
    { message: "Private browser state checkpoint failed." },
  );
  assert.equal(closed, true);
});

test("CLI rejects private credential paths inside real Git checkout and redacts path/parsing failures", async (t) => {
  const { path } = await fixture(t);
  const script = resolve("web/scripts/account-cloud-check.mjs");
  for (const candidate of [resolve("public/fake-secret-path"), path]) {
    if (candidate === path) await writeFile(path, "fake-secret-json");
    await assert.rejects(
      promisify(execFile)(process.execPath, [script], {
        env: { ...process.env, ANYWORK_DEV_BROWSER_STATE: candidate },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.equal(error.stderr, "Private browser state rejected.\n");
        assert.ok(!error.stderr.includes("fake-secret"));
        return true;
      },
    );
  }
});
