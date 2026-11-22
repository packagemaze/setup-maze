import { basename, relative, resolve, sep } from "node:path";

function requestedInput(root, projectDir, manifestPath, lockPath, profile) {
  if (profile.groups?.length || profile.allExtras || profile.defaultGroups === false)
    throw new Error("This pip plan supports requirements and explicitly named extras");
  const extras = profile.extras ?? [];
  if (!extras.every((s) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(s))) throw new Error("Invalid pip extra name");
  const suffix = extras.length ? "[" + extras.join(",") + "]" : "";
  if (lockPath === null && basename(manifestPath) === "pyproject.toml") return ["." + suffix];
  if (lockPath !== null && !/^pylock(?:\.[A-Za-z0-9_-]+)?\.toml$/u.test(basename(lockPath)))
    throw new Error("This pip plan requires a native requirements or pylock input");
  if (lockPath === null && extras.length) throw new Error("pip cannot apply extras to a requirements file");
  const path = relative(projectDir, resolve(root, lockPath ?? manifestPath))
    .split(sep)
    .join("/");
  return ["--requirement", path + suffix];
}
function receiptPackage(item) {
  const { name, version } = item.metadata ?? {};
  if (typeof name !== "string" || typeof version !== "string") throw new Error("Incomplete pip installation report");
  const info = item.download_info;
  if (!item.is_direct || !info) return { name, version };
  if (info.dir_info) return { name, version, source: "local" };
  if (info.vcs_info?.vcs === "git") return { name, version, source: "git" };
  if (info.archive_info) return { name, version, source: "archive" };
  return { name, version };
}
export const pipPlan = {
  name: "pip",
  protocol: "pypi",
  manifest: ["requirements.txt", "pyproject.toml"],
  lock: null,
  async capture({ root, projectDir, manifestPath, lockPath, profile, environment, run }) {
    const input = requestedInput(root, projectDir, manifestPath, lockPath, profile);
    const cwd = { cwd: projectDir };
    const [pip, python] = await Promise.all([
      run("python", ["-m", "pip", "--version"], cwd),
      run("python", ["--version"], cwd),
    ]);
    const version = /^pip (\S+) from /u.exec(pip.stdout)?.[1];
    const interpreter = /^Python ([0-9][^\s]*)/u.exec(python.stdout)?.[1];
    if (pip.code !== 0 || python.code !== 0 || !version || !interpreter)
      throw new Error("Cannot identify the pip interpreter");
    const args = [
      "-m",
      "pip",
      "install",
      "--dry-run",
      "--ignore-installed",
      "--no-input",
      "--quiet",
      "--disable-pip-version-check",
      "--report",
      "-",
      ...input,
    ];
    const base = {
      clientVersion: version,
      scope: "project",
      command: { name: "python", args },
      environment: { ...environment, python: interpreter },
    };
    const result = await run("python", args, cwd);
    if (result.code !== 0) return { ...base, outcome: "failed" };
    const report = JSON.parse(result.stdout);
    if (
      report.version !== "1" ||
      report.pip_version !== version ||
      !Array.isArray(report.install) ||
      report.environment?.python_full_version !== interpreter
    )
      throw new Error("Unsupported or incomplete pip installation report");
    return { ...base, outcome: "planned", packages: report.install.map(receiptPackage) };
  },
};
