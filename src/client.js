// Small client for the Requstory public API (https://requstory.com/developers/api/).

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
