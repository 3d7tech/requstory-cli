// Small client for the Requstory public API (https://requstory.com/developers/api/).
// Order to cash runs only on the MCP server (https://requstory.com/mcp), so those calls are plain JSON-RPC tools/call requests.

export const DEFAULT_BASE = "https://requstory.com/api/public/v1";

export class RequstoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createClient({ key, base = DEFAULT_BASE, fetch: doFetch = globalThis.fetch } = {}) {
  async function call(method, path, body) {
    const headers = { Accept: "application/json", "User-Agent": "requstory-cli" };
    if (key) headers.Authorization = "Bearer " + key;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await doFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new RequstoryError(res.status, "BAD_RESPONSE", `Unexpected reply from Requstory (${res.status}).`);
    }
    if (!res.ok) {
      const error = data?.error ?? {};
      throw new RequstoryError(res.status, error.code ?? "REQUEST_FAILED", error.message ?? `Request failed (${res.status}).`);
    }
    return data;
  }
  const mcpUrl = new URL(base).origin + "/mcp";
  let rpcId = 0;
  /** Calls an MCP tool and returns its structured result; a tool error becomes a RequstoryError. */
  async function tool(name, args = {}) {
    const headers = { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "requstory-cli" };
    if (key) headers.Authorization = "Bearer " + key;
    const res = await doFetch(mcpUrl, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new RequstoryError(res.status, "BAD_RESPONSE", `Unexpected reply from Requstory (${res.status}).`);
    }
    if (!res.ok || data.error) {
      throw new RequstoryError(res.status, String(data.error?.code ?? "REQUEST_FAILED"), data.error?.message ?? `Request failed (${res.status}).`);
    }
    if (data.result?.isError) throw new RequstoryError(res.status, "TOOL_ERROR", data.result.content?.[0]?.text ?? "The request could not be completed.");
    return data.result?.structuredContent ?? {};
  }
  const id = (value) => encodeURIComponent(String(value));
  return {
    account: () => call("GET", "/account"),
    companies: (query, { industry, limit } = {}) => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (industry) params.set("industry", industry);
      if (limit) params.set("limit", String(limit));
      return call("GET", "/companies" + (params.size ? "?" + params : ""));
    },
    company: (slug) => call("GET", "/companies/" + id(slug)),
    startReadiness: (website) => call("POST", "/ai-readiness", { website }),
    readiness: (domain) => call("GET", "/ai-readiness/" + id(domain)),
    startMap: (website) => call("POST", "/maps", { website }),
    job: (jobId) => call("GET", "/maps/jobs/" + id(jobId)),
    maps: () => call("GET", "/maps"),
    map: (mapId, { full = false } = {}) => call("GET", "/maps/" + id(mapId) + (full ? "?full=1" : "")),
    ask: (mapId, question, { ai = false } = {}) => call("POST", "/maps/" + id(mapId) + "/ask", { question, ai }),
    o2c: {
      demo: ({ model } = {}) => tool("start_o2c_demo", model ? { model } : {}),
      start: (business, { mapId, model } = {}) => tool("start_o2c_run", { business, ...(mapId ? { mapId } : {}), ...(model ? { model } : {}) }),
      advance: (runId, { steps } = {}) => tool("advance_o2c_run", { runId, ...(steps ? { steps } : {}) }),
      exceptions: (runId) => tool("list_o2c_exceptions", { runId }),
      resolve: (runId, exceptionId, choice, text) => tool("resolve_o2c_exception", { runId, exceptionId, choice, ...(text ? { text } : {}) }),
      order: (runId, order) => tool("get_o2c_order", { runId, order }),
      export: (runId) => tool("export_o2c_run", { runId }),
    },
    tool,
  };
}

/** Polls until a job or check leaves queued/running, or the time runs out. */
export async function waitFor(read, { seconds = 120, every = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const until = Date.now() + seconds * 1000;
  let result = await read();
  while (["queued", "running"].includes(result.status) && Date.now() < until) {
    await sleep(every * 1000);
    result = await read();
  }
  return result;
}
