import { captureReport, uploadReport } from "./capture.mjs";
const input = (name) => process.env["INPUT_" + name.toUpperCase()] ?? "";
try {
  const report = await captureReport({
    workspace: process.env.GITHUB_WORKSPACE,
    sha: process.env.GITHUB_SHA,
    job: process.env.GITHUB_JOB,
    client: input("client"),
    feed: input("feed"),
    projectPath: input("project-path"),
    manifestPath: input("manifest"),
    lockPath: input("lock"),
    profile: JSON.parse(input("profile") || "{}"),
  });
  await uploadReport({ api: input("api-url"), organization: input("organization"), project: input("project"), report });
  console.log("PackageMaze recorded the native install plan.");
} catch {
  console.error("PackageMaze could not capture this native plan. Check the client, inputs and CI sign-in.");
  process.exitCode = 1;
}
