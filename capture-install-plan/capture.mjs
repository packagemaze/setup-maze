import { pdmPlan } from "./adapters/pdm.mjs";
import { createHash } from "node:crypto";
import { mkdtemp, rm, mkdir, realpath, writeFile, access } from "node:fs/promises";
import { tmpdir, platform, arch } from "node:os";
import { dirname, join, resolve, isAbsolute, sep } from "node:path";
import { plannerProcess } from "./process.mjs";
import { uvPlan } from "./adapters/uv.mjs";
import { npmPlan } from "./adapters/npm.mjs";
import { pipPlan } from "./adapters/pip.mjs";
import { poetryPlan } from "./adapters/poetry.mjs";

const adapters = new Map([uvPlan, npmPlan, pipPlan, poetryPlan, pdmPlan].map((a) => [a.name, a]));
function cleanPath(value) {
  if (!value || value === ".") return "";
  if (/[\\:\p{Cc}]/u.test(value) || value.split("/").some((s) => !s || s === "." || s === ".."))
    throw new Error("Expected a repository-relative path");
  return value;
}
async function git(run, cwd, args) {
  const result = await run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", ...args], { cwd });
  if (result.code !== 0) throw new Error("Could not read the committed Git tree");
  return result.stdout.trimEnd();
}
async function checkout(run, source, root, sha) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sha) || (await git(run, source, ["rev-parse", "HEAD"])) !== sha)
    throw new Error("Checkout does not match the GitHub Run commit");
  const objects = await git(run, source, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]);
  if (!isAbsolute(objects) || /[\r\n]/u.test(objects)) throw new Error("Cannot locate Git objects");
  await git(run, root, ["init", "--quiet"]);
  await writeFile(join(root, ".git", "objects", "info", "alternates"), objects + "\n");
  await git(run, root, ["checkout", "--quiet", "--detach", sha]);
}
async function fileInput(run, root, path, sha) {
  const actual = await realpath(resolve(root, path));
  if (actual !== resolve(root, path))
    throw new Error("The plan input must be a regular committed file in this repository");
  const oid = await git(run, root, ["rev-parse", "--verify", sha + ":" + path]);
  const digest = await git(run, root, ["hash-object", "--no-filters", "--", path]);
  if (oid !== digest) throw new Error("The native planner's input differs from the committed blob");
  return { path, blob: oid };
}
async function discoverFile(root, start, names, ancestors) {
  if (names === null) return null;
  let dir = start;
  for (;;) {
    for (const name of [names].flat()) {
      const path = dir ? dir + "/" + name : name;
      try {
        await access(resolve(root, path));
        return path;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!ancestors || !dir) break;
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
  throw new Error("The native client’s required committed input was not found");
}
function checkedNames(profile) {
  for (const key of ["groups", "extras"]) {
    if (
      profile[key] !== undefined &&
      (!Array.isArray(profile[key]) ||
        profile[key].length > 32 ||
        !profile[key].every((s) => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(s)))
    )
      throw new Error("Invalid native group or extra");
  }
}
function checkedProfile(profile) {
  const allowed = ["groups", "extras", "defaultGroups", "allExtras"];
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    Object.keys(profile).some((k) => !allowed.includes(k))
  )
    throw new Error("Unsupported install profile");
  checkedNames(profile);
  for (const key of ["defaultGroups", "allExtras"])
    if (profile[key] !== undefined && typeof profile[key] !== "boolean")
      throw new Error("Invalid native profile option");
  return profile;
}
async function projectInputs(root, adapter, projectPath, manifestPath, lockPath) {
  const project = cleanPath(projectPath);
  const manifest = cleanPath(manifestPath) || (await discoverFile(root, project, adapter.manifest, false));
  const lock = cleanPath(lockPath) || (await discoverFile(root, project, adapter.lock, true));
  if ((dirname(manifest) === "." ? "" : dirname(manifest).split(sep).join("/")) !== project)
    throw new Error("Manifest must belong to the requested Project directory");
  return { project, manifest, lock };
}
export async function captureReport({
  workspace,
  sha,
  client,
  projectPath = "",
  manifestPath,
  lockPath,
  profile = {},
  feed,
  job,
  env = process.env,
}) {
  const adapter = adapters.get(client);
  if (!adapter) throw new Error("This client does not provide a supported native installation plan");
  const source = await realpath(workspace);
  const temp = await realpath(await mkdtemp(join(tmpdir(), "packagemaze-committed-plan-")));
  try {
    const scratch = join(temp, "home"),
      root = join(temp, "checkout");
    await Promise.all([mkdir(scratch), mkdir(root)]);
    const run = plannerProcess(scratch, source, env);
    await checkout(run, source, root, sha);
    const { project, manifest, lock } = await projectInputs(root, adapter, projectPath, manifestPath, lockPath);
    const inputs = () =>
      Promise.all([fileInput(run, root, manifest, sha), lock ? fileInput(run, root, lock, sha) : null]);
    const [files, boundLock] = await inputs();
    const safeProfile = checkedProfile(profile);
    const native = await adapter.capture({
      root,
      projectDir: resolve(root, project),
      projectPath: project,
      manifestPath: manifest,
      lockPath: lock,
      profile: safeProfile,
      environment: { os: platform(), arch: arch() },
      run,
    });
    await inputs();
    const { clientVersion, ...evidence } = native;
    const captureId = invocationId([
      env.GITHUB_ACTION ?? "capture-install-plan",
      project,
      files,
      boundLock,
      client,
      safeProfile,
      native.environment,
      native.command,
    ]);
    return {
      schema: 1,
      captureId,
      feed,
      sha,
      projectPath: project,
      manifest: files,
      lock: boundLock,
      client: { name: client, version: clientVersion },
      profile: safeProfile,
      ...evidence,
      ...(job ? { job } : {}),
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
function invocationId(inputs) {
  const bytes = createHash("sha256").update(JSON.stringify(inputs)).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export { uploadReport } from "./upload.mjs";
