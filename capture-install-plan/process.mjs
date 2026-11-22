import { spawn } from "node:child_process";
import { delimiter, isAbsolute, relative, sep } from "node:path";

export function plannerProcess(scratch, workspace, baseEnv = process.env) {
  const path = baseEnv.PATH.split(delimiter)
    .filter((part) => {
      const rel = relative(workspace, part);
      return isAbsolute(part) && (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel));
    })
    .join(delimiter);
  const env = {
    PATH: path,
    HOME: scratch,
    TMPDIR: scratch,
    TEMP: scratch,
    TMP: scratch,
    USERPROFILE: scratch,
    XDG_CONFIG_HOME: scratch,
    XDG_CACHE_HOME: scratch,
    CI: "true",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    PIP_NO_INPUT: "1",
    PYTHONNOUSERSITE: "1",
  };
  if (process.platform === "win32") Object.assign(env, { SystemRoot: baseEnv.SystemRoot, ComSpec: baseEnv.ComSpec });
  return (exe, args, options = {}) =>
    boundedProcess(exe, args, { cwd: options.cwd ?? scratch, env: { ...env, ...options.env } });
}
function boundedProcess(exe, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { ...options, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    let length = 0;
    const stop = () => {
      child.kill("SIGKILL");
      reject(new Error("Native process exceeded its capture limit"));
    };
    const timer = setTimeout(stop, 120000);
    child.stdout.on("data", (part) => {
      length += part.length;
      if (length > 8 * 1024 * 1024) stop();
      else chunks.push(part);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Required native executable was unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") });
    });
  });
}
