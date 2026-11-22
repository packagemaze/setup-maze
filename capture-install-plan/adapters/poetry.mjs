import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, win32 } from "node:path";
import { withEmptyPython } from "./empty-python.mjs";

function installArguments(profile) {
  const groups = profile.groups ?? [],
    extras = profile.extras ?? [];
  if (![...groups, ...extras].every((value) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)))
    throw new Error("Invalid Poetry group or extra");
  const args = ["--no-plugins", "--no-ansi", "--no-interaction", "install", "--dry-run", "--no-root"];
  if (profile.defaultGroups === false) args.push("--only", ["main", ...groups].join(","));
  else if (groups.length) args.push("--with", groups.join(","));
  if (profile.allExtras && extras.length) throw new Error("Choose all Poetry extras or name individual extras");
  if (profile.allExtras) args.push("--all-extras");
  else for (const extra of extras) args.push("--extras", extra);
  return args;
}
export function poetryPackages(output) {
  const summary = /^Package operations: (\d+) installs?, (\d+) updates?, (\d+) removals?(?:, (\d+) skipped)?$/mu.exec(
    output,
  );
  if (!summary && /^No dependencies to install or update$/mu.test(output)) return [];
  if (!summary || summary[2] !== "0" || summary[3] !== "0")
    throw new Error("Poetry did not return a complete fresh-environment plan");
  const packages = [];
  for (const line of output.split(/\r?\n/u)) {
    if (!/^\s*-\s/u.test(line)) continue;
    if (/^\s*-\s.*: Skipped for the following reason:/u.test(line)) continue;
    const row = /^\s*- Installing ([A-Za-z0-9][A-Za-z0-9._-]*) \(([A-Za-z0-9][A-Za-z0-9.!+_-]*)(?: ([^\n]*))?\)$/u.exec(
      line,
    );
    if (!row) throw new Error("Unrecognized Poetry install operation");
    const local = row[3] && (isAbsolute(row[3]) || win32.isAbsolute(row[3]));
    packages.push({ name: row[1], version: row[2], ...(local ? { source: "local" } : {}) });
  }
  if (packages.length !== Number(summary[1])) throw new Error("Incomplete Poetry package list");
  return packages;
}
export const poetryPlan = {
  name: "poetry",
  protocol: "pypi",
  manifest: "pyproject.toml",
  lock: "poetry.lock",
  async capture({ projectDir, manifestPath, lockPath, profile, environment, run }) {
    if (!lockPath || basename(lockPath) !== "poetry.lock" || dirname(lockPath) !== dirname(manifestPath))
      throw new Error("Poetry requires its governing Lock beside pyproject.toml");
    const args = installArguments(profile);
    const tool = await run("poetry", ["--no-plugins", "--version"], { cwd: projectDir });
    const version = /^Poetry \(version ([^\s)]+)\)/u.exec(tool.stdout)?.[1];
    if (tool.code !== 0 || !version) throw new Error("Cannot identify Poetry");
    return withEmptyPython(run, projectDir, async ({ target, version: python }) => {
      const options = {
        cwd: projectDir,
        env: { VIRTUAL_ENV: target, POETRY_VIRTUALENVS_CREATE: "false", NO_COLOR: "1" },
      };
      const selected = await run("poetry", ["--no-plugins", "--no-ansi", "env", "info", "--path"], options);
      if (selected.code !== 0 || (await realpath(selected.stdout.trim())) !== (await realpath(target)))
        throw new Error("Poetry did not select the empty environment");
      const base = {
        clientVersion: version,
        scope: "project",
        environment: { ...environment, python },
        command: { name: "poetry", args },
      };
      const result = await run("poetry", args, options);
      if (result.code !== 0) return { ...base, outcome: "failed" };
      return { ...base, outcome: "planned", packages: poetryPackages(result.stdout) };
    });
  },
};
