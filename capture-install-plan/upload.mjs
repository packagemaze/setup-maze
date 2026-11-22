import { createHash } from "node:crypto";
function receiptUrl(api, organization, project) {
  if (!["https://api.packagemaze.com", "https://api.packagemaze.dev"].includes(api))
    throw new Error("Expected a PackageMaze API origin");
  if (!/^[A-Za-z0-9_-]+$/u.test(organization) || !/^[A-Za-z0-9_-]+$/u.test(project))
    throw new Error("Invalid PackageMaze Project address");
  return api + "/v1/organizations/" + organization + "/projects/" + project + "/dependency-biography/install-plans";
}
function githubEndpoint(env) {
  const endpoint = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    !/(?:^|\.)actions\.(?:githubusercontent\.com|github\.com)$/u.test(endpoint.hostname) ||
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  )
    throw new Error("GitHub Actions id-token: write is required");
  return endpoint;
}
async function assertion(audience, env, send) {
  const endpoint = githubEndpoint(env);
  endpoint.searchParams.set("audience", audience);
  const fresh = await send(endpoint, {
    headers: { Authorization: "Bearer " + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    redirect: "error",
  });
  if (!fresh.ok) throw new Error("GitHub declined the install plan assertion");
  const token = (await fresh.json()).value;
  if (typeof token !== "string" || !token) throw new Error("GitHub returned no install plan assertion");
  return token;
}
async function postReceipt(target, body, token, send) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await send(target, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body,
      redirect: "error",
    });
    if (result.ok) return;
    if (result.status < 500 || attempt === 1)
      throw new Error("PackageMaze declined the install plan (" + result.status + ")");
  }
}

export async function uploadReport({ api, organization, project, report, env = process.env, send = fetch }) {
  const target = receiptUrl(api, organization, project);
  const body = JSON.stringify(report);
  if (Buffer.byteLength(body) > 512 * 1024) throw new Error("Native plan exceeds the complete receipt byte budget");
  const audience = target + "#sha256=" + createHash("sha256").update(body).digest("hex");
  const token = await assertion(audience, env, send);
  return postReceipt(target, body, token, send);
}
