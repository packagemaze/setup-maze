import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withEmptyPython(run, cwd, read) {
  const target = await mkdtemp(join(tmpdir(), "packagemaze-python-plan-"));
  try {
    const created = await run("python", ["-m", "venv", "--without-pip", target], { cwd });
    if (created.code !== 0) throw new Error("Cannot create an empty Python environment");
    const executable =
      process.platform === "win32" ? join(target, "Scripts", "python.exe") : join(target, "bin", "python");
    const native = await run(executable, ["--version"], { cwd });
    const version = /^Python (\S+)/u.exec(native.stdout)?.[1];
    if (native.code !== 0 || !version) throw new Error("Cannot identify the native Python interpreter");
    return await read({ target, executable, version });
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}
