import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { captureReport, uploadReport } from "./capture.mjs";
import { plannerProcess } from "./process.mjs";

const temporary = [];
after(async () => {
  await Promise.all(temporary.map((p) => rm(p, { recursive: true, force: true })));
});
async function temp() {
  const p = await mkdtemp(join(tmpdir(), "packagemaze-plan-test-"));
  temporary.push(p);
  return p;
}
function commitFixture(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet", "-b", "fixture");
  git("add", "--", ".");
  git(
    "-c",
    "user.email=test@example.org",
    "-c",
    "user.name=fixture",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  return git;
}
test("a real frozen uv plan selects the committed member in a fresh environment and preserves an unversioned peer", async () => {
  const root = await temp(),
    external = await temp();
  await mkdir(join(root, "member"));
  await mkdir(join(root, "peer"));
  await writeFile(
    join(root, "pyproject.toml"),
    '[project]\nname="workspace"\nversion="1"\nrequires-python=">=3.9"\n[tool.uv.workspace]\nmembers=["member","peer"]\n',
  );
  await writeFile(
    join(root, "member", "pyproject.toml"),
    '[project]\nname="consumer"\nversion="1"\nrequires-python=">=3.9"\ndependencies=["sibling"]\n[tool.uv.sources]\nsibling={workspace=true}\n[dependency-groups]\nempty=[]\n',
  );
  await writeFile(
    join(root, "peer", "pyproject.toml"),
    '[project]\nname="sibling"\nversion="9.9.9"\nrequires-python=">=3.9"\n[tool.uv]\npackage=true\n',
  );
  execFileSync("uv", ["lock", "--offline"], {
    cwd: root,
    env: { PATH: process.env.PATH, UV_CACHE_DIR: external, UV_PYTHON_DOWNLOADS: "never" },
    stdio: "ignore",
  });
  const git = commitFixture(root);
  const options = {
    workspace: root,
    sha: git("rev-parse", "HEAD"),
    feed: "example/python",
    client: "uv",
    projectPath: "member",
    profile: { groups: ["empty"] },
  };
  // The CI checkout can contain generated files, and a different working-tree manifest.
  await writeFile(join(root, "member/pyproject.toml"), "invalid.toml = [");
  const first = await captureReport(options);
  assert.equal(first.outcome, "planned");
  assert.deepEqual(first.packages, [{ name: "sibling", source: "repository" }]);
  assert.equal(first.manifest.blob, git("rev-parse", "HEAD:member/pyproject.toml"));
  assert.equal(first.lock.path, "uv.lock");
  assert.deepEqual(await captureReport(options), first);
  const empty = await captureReport({ ...options, projectPath: "", profile: {} });
  assert.deepEqual(empty.packages, []);
  assert.equal(empty.outcome, "planned");
  const invalid = await captureReport({ ...options, profile: { groups: ["not-declared"] } });
  assert.equal(invalid.outcome, "failed");
  assert.equal(invalid.packages, undefined);
});
test("only native execution inputs are inherited by planner subprocesses", async () => {
  const root = await temp();
  const run = plannerProcess(root, root, {
    PATH: process.env.PATH,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "forbidden",
    GITHUB_TOKEN: "forbidden",
    NPM_TOKEN: "forbidden",
  });
  const { stdout } = await run(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify(Object.keys(process.env)))",
  ]);
  assert.equal(/(TOKEN|ACTIONS_ID_TOKEN|GITHUB)/u.test(stdout), false);
});
test("the signed audience commits to the exact report and destination before the post", async () => {
  const seen = [];
  const report = { schema: 1, outcome: "planned", packages: [] };
  const send = async (url, opts) => {
    seen.push([String(url), opts]);
    return seen.length === 1
      ? Response.json({ value: "receipt-assertion" })
      : new Response(null, { status: 204 });
  };
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://runner.actions.githubusercontent.com/idtoken",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-only",
  };
  await uploadReport({
    api: "https://api.packagemaze.com",
    organization: "org",
    project: "7",
    report,
    send,
    env,
  });
  const [[identity], [destination, posted]] = seen;
  assert.equal(
    new URL(identity).searchParams.get("audience"),
    destination + "#sha256=" + createHash("sha256").update(posted.body).digest("hex"),
  );
  assert.equal(posted.headers.Authorization, "Bearer receipt-assertion");
  assert.equal(posted.redirect, "error");
  await assert.rejects(
    uploadReport({
      api: "https://unknown.example",
      organization: "org",
      project: "7",
      report,
      send,
      env,
    }),
  );
});

test("npm reports the committed addition from a fresh checkout", async () => {
  const root = await temp();
  const manifest = { name: "example", version: "1.0.0", dependencies: { "is-number": "7.0.0" } };
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  await writeFile(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "example",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": manifest,
        "node_modules/is-number": {
          version: "7.0.0",
          resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
        },
      },
    }),
  );
  const git = commitFixture(root);
  const report = await captureReport({
    workspace: root,
    sha: git("rev-parse", "HEAD"),
    client: "npm",
    feed: "example/npm",
  });
  assert.deepEqual(report.packages, [{ name: "is-number", version: "7.0.0" }]);
  assert.equal(report.lock.blob, git("rev-parse", "HEAD:package-lock.json"));
});
