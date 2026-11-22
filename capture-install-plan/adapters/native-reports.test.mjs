import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { npmPlan } from "./npm.mjs";
import { pipPlan } from "./pip.mjs";
import { poetryPackages } from "./poetry.mjs";
import { pdmPackages } from "./pdm.mjs";

test("npm keeps one canonical target for the authored alias and rejects incomplete or non-fresh reports", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pm-npm-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = { "": { name: "app", version: "1.0.0" }, "node_modules/alias": { name: "real", version: "1.2.3" } };
  await writeFile(join(root, "package.json"), JSON.stringify(packages[""]));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  const row = { name: "alias", version: "1.2.3", path: join(root, "node_modules", "alias") };
  let result = { add: [row], added: 1, changed: 0, removed: 0 };
  const capture = () =>
    npmPlan.capture({
      root,
      projectDir: root,
      manifestPath: "package.json",
      lockPath: "package-lock.json",
      profile: {},
      environment: {},
      run: async (_name, args) => ({
        code: 0,
        stdout:
          args[0] === "version"
            ? JSON.stringify({ npm: "11.19.1", node: "24.22.1" })
            : "add alias 1.2.3\n" + JSON.stringify(result),
      }),
    });
  assert.deepEqual((await capture()).packages, [{ name: "real", version: "1.2.3" }]);
  result = { added: 1, changed: 0, removed: 0 };
  await assert.rejects(capture, /cannot identify every/);
  await mkdir(join(root, "node_modules"));
  await assert.rejects(capture, /without installed modules/);
});
test("pip records an empty supported report, native failure and unavailable format distinctly", async () => {
  const settings = {
    root: "/repo",
    projectDir: "/repo",
    manifestPath: "requirements.txt",
    lockPath: null,
    profile: {},
    environment: {},
  };
  const report = { version: "1", pip_version: "26.0.1", environment: { python_full_version: "3.14.3" }, install: [] };
  const capture = (output, code = 0) =>
    pipPlan.capture({
      ...settings,
      run: async (_name, args) => {
        if (args[0] === "--version") return { code: 0, stdout: "Python 3.14.3" };
        if (args.includes("--version")) return { code: 0, stdout: "pip 26.0.1 from /private/path (python 3.14)" };
        assert.equal(args.at(-1), "requirements.txt");
        return { code, stdout: JSON.stringify(output) };
      },
    });
  assert.deepEqual((await capture(report)).packages, []);
  assert.equal((await capture(null, 1)).outcome, "failed");
  assert.equal((await capture(null, 1)).packages, undefined);
  await assert.rejects(() => capture({ ...report, version: "2" }), /Unsupported/);
  const packages = [
    {
      metadata: { name: "linked", version: "1.0" },
      is_direct: true,
      download_info: { dir_info: {}, url: "file:///private/checkout" },
    },
  ];
  assert.deepEqual((await capture({ ...report, install: packages })).packages, [
    { name: "linked", version: "1.0", source: "local" },
  ]);
});
test("Poetry requires the complete native operation count and withholds paths", () => {
  assert.deepEqual(
    poetryPackages(
      "Package operations: 1 install, 0 updates, 0 removals\n  - Installing linked (1.2.3 /private/checkout)",
    ),
    [{ name: "linked", version: "1.2.3", source: "local" }],
  );
  assert.deepEqual(poetryPackages("No dependencies to install or update"), []);
  assert.throws(
    () => poetryPackages("Package operations: 2 installs, 0 updates, 0 removals\n  - Installing one (1.0)"),
    /Incomplete/,
  );
});
test("PDM emits the additions from its fresh environment, including the transitive wheel", () => {
  assert.deepEqual(pdmPackages("Packages to add:\n  - leaf 2.0.0\n  - top 1.0.0"), [
    { name: "leaf", version: "2.0.0" },
    { name: "top", version: "1.0.0" },
  ]);
  assert.deepEqual(pdmPackages("All packages are synced to date, nothing to do."), []);
  assert.throws(() => pdmPackages("Packages to update:\n - leaf 1.0 -> 2.0"), /fresh-environment/);
});
