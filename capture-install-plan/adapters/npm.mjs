import { lstat, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const args = ["ci", "--prefix", ".", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund", "--json"];
const locks = ["npm-shrinkwrap.json", "package-lock.json"];

async function trackedJson(path) {
  if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error("npm plan input exceeds the supported size");
  return JSON.parse(await readFile(path, "utf8"));
}
async function present(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function relativeLocation(root, path) {
  const local = relative(root, path);
  if (!local || local === ".." || local.startsWith(".." + sep) || isAbsolute(local))
    throw new Error("npm reported a package outside the install directory");
  return local.split(sep).join("/");
}
async function requireEmptyModules(projectDir, entries) {
  for (const path of Object.keys(entries)) {
    if (path.split("/").includes("node_modules")) continue;
    const directory = path ? resolve(projectDir, relativeLocation(projectDir, resolve(projectDir, path))) : projectDir;
    if (await present(join(directory, "node_modules")))
      throw new Error("A complete npm plan requires a checkout without installed modules");
  }
}
function additions(stdout, entries, root) {
  const start = stdout.search(/^\{/mu);
  if (start < 0) throw new Error("npm did not return a JSON plan");
  const data = JSON.parse(stdout.slice(start));
  if (!Array.isArray(data.add) || data.added !== data.add.length || data.changed !== 0 || data.removed !== 0)
    throw new Error("This npm report cannot identify every planned addition");
  return data.add.map((row) => {
    const pkg = entries[relativeLocation(root, row.path)];
    if (!pkg || typeof row.name !== "string" || typeof row.version !== "string")
      throw new Error("npm reported an unidentified package");
    const saved = pkg.link === true ? entries[pkg.resolved] : pkg;
    if (!saved || saved.version !== row.version) throw new Error("npm report and Lock identify different targets");
    return { name: saved.name ?? row.name, version: row.version, ...(pkg.link === true ? { source: "local" } : {}) };
  });
}
export const npmPlan = {
  name: "npm",
  protocol: "npm",
  manifest: "package.json",
  lock: locks,
  async capture({ root, projectDir, manifestPath, lockPath, profile, environment, run }) {
    if (profile.groups?.length || profile.extras?.length || profile.allExtras || profile.defaultGroups === false)
      throw new Error("This npm plan supports the configured default install");
    if (!lockPath || !locks.includes(basename(lockPath)) || dirname(manifestPath) !== dirname(lockPath))
      throw new Error("npm ci requires the governing Lock alongside the root manifest");
    if (basename(lockPath) === "package-lock.json" && (await present(join(projectDir, "npm-shrinkwrap.json"))))
      throw new Error("npm gives the shrinkwrap file precedence");
    const manifest = await trackedJson(join(root, manifestPath));
    const { packages } = await trackedJson(join(root, lockPath));
    if (!packages || typeof packages !== "object" || !Object.hasOwn(packages, ""))
      throw new Error("This npm Lock does not identify the install locations");
    await requireEmptyModules(projectDir, packages);
    const version = await run("npm", ["version", "--json"], { cwd: projectDir });
    if (version.code !== 0) throw new Error("Cannot determine the npm version");
    const versions = JSON.parse(version.stdout);
    const base = {
      clientVersion: versions.npm,
      environment: { ...environment, node: versions.node },
      command: { name: "npm", args },
      scope: manifest.workspaces ? "workspace" : "project",
    };
    const result = await run("npm", args, { cwd: projectDir });
    if (result.code !== 0) return { ...base, outcome: "failed" };
    return { ...base, outcome: "planned", packages: additions(result.stdout, packages, projectDir) };
  },
};
