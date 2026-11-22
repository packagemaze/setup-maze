import { basename, dirname, resolve } from "node:path";
import { withEmptyPython } from "./empty-python.mjs";

export function pdmPackages(stdout) {
  const body = stdout.trim().split(/\r?\n/u);
  const start = body.indexOf("Packages to add:");
  if (start < 0 && body.at(-1) === "All packages are synced to date, nothing to do.") return [];
  if (start < 0 || start + 1 === body.length) throw new Error("PDM did not report a complete fresh-environment plan");
  return body.slice(start + 1).map((line) => {
    const row = /^\s+- ([A-Za-z0-9][A-Za-z0-9._-]*) ([A-Za-z0-9][A-Za-z0-9.!+_-]*)$/u.exec(line);
    if (!row) throw new Error("Unrecognized PDM operation in a fresh environment");
    return { name: row[1], version: row[2] };
  });
}
export const pdmPlan = {
  name: "pdm",
  protocol: "pypi",
  manifest: "pyproject.toml",
  lock: ["pylock.toml", "pdm.lock"],
  async capture({ projectDir, manifestPath, lockPath, profile, environment, run }) {
    if (!lockPath || dirname(lockPath) !== dirname(manifestPath))
      throw new Error("PDM requires a Project-local Lock for this plan");
    if (profile.extras?.length || profile.allExtras || profile.defaultGroups === false)
      throw new Error("PDM plan supports default and named groups");
    const args = ["sync", "--dry-run", "--no-self", "--lockfile", basename(lockPath)];
    for (const group of profile.groups ?? []) args.push("--group", group);
    const tool = await run("pdm", ["--version"], { cwd: projectDir });
    const version = /^PDM, version (\S+)/u.exec(tool.stdout)?.[1];
    if (tool.code !== 0 || !version) throw new Error("Cannot identify PDM");
    return withEmptyPython(run, projectDir, async ({ target, executable, version: python }) => {
      const options = {
        cwd: projectDir,
        env: { VIRTUAL_ENV: target, PDM_PYTHON: executable, PDM_CHECK_UPDATE: "false", NO_COLOR: "1" },
      };
      const selected = await run("pdm", ["info", "--python"], options);
      if (selected.code !== 0 || resolve(selected.stdout.trim()) !== resolve(executable))
        throw new Error("PDM did not select the empty interpreter");
      const base = {
        clientVersion: version,
        scope: "project",
        environment: { ...environment, python },
        command: { name: "pdm", args },
      };
      const result = await run("pdm", args, options);
      if (result.code !== 0) return { ...base, outcome: "failed" };
      return { ...base, outcome: "planned", packages: pdmPackages(result.stdout) };
    });
  },
};
