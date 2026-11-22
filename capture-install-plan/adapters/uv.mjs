import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

function profileArgs(profile) {
  const args = [];
  if (profile.defaultGroups === false) args.push("--no-default-groups");
  if (profile.allExtras) args.push("--all-extras");
  for (const name of profile.groups ?? []) args.push("--group", name);
  for (const name of profile.extras ?? []) args.push("--extra", name);
  return args;
}
function kind(source, root, lockDir) {
  if (typeof source.registry === "string") return "registry";
  if (typeof source.git === "string") return "git";
  if (typeof source.url === "string") return "archive";
  const path = source.editable ?? source.directory ?? source.path;
  if (typeof path !== "string") return undefined;
  const rel = relative(root, resolve(lockDir, path));
  return rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? "local" : "repository";
}
function lockedSources(items, root, lockDir) {
  const sources = new Map();
  for (const [name, version, source] of items) {
    const row = { version, kind: kind(source, root, lockDir) };
    const group = sources.get(name) ?? [];
    group.push(row);
    sources.set(name, group);
  }
  return sources;
}
function packageFact(change, sources) {
  if (change.action !== "installed" || typeof change.name !== "string")
    throw new Error("Incomplete native uv install plan");
  const found = sources.get(change.name)?.filter((r) => change.version === undefined || r.version === change.version);
  const kinds = new Set(found?.map((r) => r.kind));
  const source = kinds.size === 1 ? [...kinds][0] : undefined;
  return {
    name: change.name,
    ...(change.version === undefined ? {} : { version: change.version }),
    ...(source ? { source } : {}),
  };
}
function assertFreshPlan(p) {
  if (
    p.schema?.version !== "preview" ||
    p.dry_run !== true ||
    p.target !== "project" ||
    p.lock?.action !== "use" ||
    p.sync?.action !== "create" ||
    !Array.isArray(p.sync.changes)
  )
    throw new Error("Unsupported or incomplete native uv plan");
}
async function validateReport(raw, projectDir, lockPath, envDir) {
  const p = JSON.parse(raw);
  assertFreshPlan(p);
  if (
    (await realpath(p.project.path)) !== (await realpath(projectDir)) ||
    (await realpath(p.lock.path)) !== (await realpath(lockPath)) ||
    resolve(p.sync.environment.path) !== resolve(envDir)
  )
    throw new Error("Native uv plan targeted another Project, Lock or environment");
  if (typeof p.sync.environment.python.version !== "string") throw new Error("Missing native uv Python environment");
  return p.sync;
}
const script = fileURLToPath(new URL("./uv-inputs.py", import.meta.url));
async function requireNativeReport(run) {
  const help = await run("uv", ["sync", "--help"]);
  if (
    help.code !== 0 ||
    !["--output-format", "--dry-run", "--frozen", "--package"].every((flag) => help.stdout.includes(flag))
  )
    throw new Error("This uv version cannot produce a frozen native plan");
}
export const uvPlan = {
  name: "uv",
  protocol: "pypi",
  manifest: "pyproject.toml",
  lock: "uv.lock",
  async capture({ root, projectDir, manifestPath, lockPath, environment, profile, run }) {
    const temp = await mkdtemp(join(tmpdir(), "packagemaze-native-uv-"));
    try {
      const lock = resolve(root, lockPath);
      const [native, files] = await Promise.all([
        run("uv", ["--version"]),
        run("python3", ["-I", script, resolve(root, manifestPath), lock]),
        requireNativeReport(run),
      ]);
      const version = /^uv ([^\s]+)/u.exec(native.stdout)?.[1];
      if (native.code !== 0 || files.code !== 0 || !version)
        throw new Error("Cannot identify native uv or its Project inputs");
      const inputs = JSON.parse(files.stdout);
      const args = [
        "sync",
        "--frozen",
        "--dry-run",
        "--output-format",
        "json",
        "--package",
        inputs.member,
        ...profileArgs(profile),
      ];
      const cmd = { name: "uv", args };
      const envDir = join(await realpath(temp), "environment");
      const result = await run("uv", args, {
        cwd: projectDir,
        env: { UV_PROJECT_ENVIRONMENT: envDir, UV_PYTHON_DOWNLOADS: "never" },
      });
      const base = { scope: "project", clientVersion: version, command: cmd, environment };
      if (result.code !== 0) return { ...base, outcome: "failed" };
      const sync = await validateReport(result.stdout, projectDir, lock, envDir);
      const sources = lockedSources(inputs.packages, root, dirname(lock));
      return {
        ...base,
        environment: { ...environment, python: sync.environment.python.version },
        outcome: "planned",
        packages: sync.changes.map((c) => packageFact(c, sources)),
      };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
};
