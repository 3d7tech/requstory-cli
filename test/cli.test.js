import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient, waitFor } from "../src/client.js";
import { configPath, parseArgs, run } from "../src/cli.js";

const KEY = "rqs_" + "a".repeat(40);

/** A fake API: routes "METHOD /path" to replies, and records calls. */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const path = url.replace("https://requstory.com/api/public/v1", "");
    calls.push({ method: init.method, path, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const reply = routes[`${init.method} ${path}`];
    const next = Array.isArray(reply) ? reply.shift() : reply;
    if (!next) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "No route " + path } }), { status: 404 });
    return next.body ? new Response(JSON.stringify(next.body), { status: next.status }) : new Response(JSON.stringify(next), { status: 200 });
  };
  return { fetch, calls };
}

async function cli(argv, routes, env = {}) {
  const { fetch, calls } = fakeFetch(routes);
  let text = "";
  const dir = await mkdtemp(join(tmpdir(), "requstory-"));
  const code = await run(argv, { env: { XDG_CONFIG_HOME: dir, ...env }, out: (s) => (text += s), fetch, sleep: async () => {} });
  return { code, text, calls, dir };
}

test("parses commands, arguments and flags", () => {
  assert.deepEqual(parseArgs(["ask", "id", "who", "owns", "billing", "--ai"]), { command: "ask", args: ["id", "who", "owns", "billing"], flags: new Set(["ai"]) });
});

test("help lists every command", async () => {
  const { text } = await cli(["--help"], {});
  for (const c of ["login", "companies", "score", "readiness", "map", "job", "maps", "show", "ask"]) assert.match(text, new RegExp(`\\b${c}\\b`));
});

test("public search works without a key and sends none", async () => {
  const { text, calls } = await cli(["companies", "post", "hog"], {
    "GET /companies?q=post+hog": { companies: [{ slug: "posthog-com", name: "PostHog", website: "https://posthog.com/", score: 71 }] },
  });
  assert.match(text, /posthog-com\s+71\s+PostHog/);
  assert.equal(calls[0].headers.Authorization, undefined);
});

test("score shows gaps most costly first", async () => {
  const { text } = await cli(["score", "posthog-com"], {
    "GET /companies/posthog-com": { name: "PostHog", website: "https://posthog.com/", page: "https://requstory.com/companies/posthog-com/", score: { total: 71, place: { rank: 3, size: 20 } }, gaps: [{ text: "No contact page", cost: 8.3 }] },
  });
  assert.match(text, /Ease score: 71\/100/);
  assert.match(text, /Place: 3 of 20/);
  assert.match(text, /- No contact page \(−8.3\)/);
});

test("login checks the key, then saves it privately; later calls send it", async () => {
  const account = { name: "Ada", email: "ada@example.com", plan: "free", credits: 0, maps: 0, mapsLeftToday: 5 };
  const { text, dir } = await cli(["login", KEY], { "GET /account": account });
  assert.match(text, /Signed in as Ada/);
  const file = configPath({ XDG_CONFIG_HOME: dir });
  assert.equal(JSON.parse(await readFile(file, "utf8")).key, KEY);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const { fetch, calls } = fakeFetch({ "GET /maps": { maps: [] } });
  let out = "";
  await run(["maps"], { env: { XDG_CONFIG_HOME: dir }, out: (s) => (out += s), fetch });
  assert.equal(calls[0].headers.Authorization, "Bearer " + KEY);
  assert.match(out, /No saved maps yet/);
});

test("login refuses a malformed key without calling the API", async () => {
  await assert.rejects(cli(["login", "nope"], {}), /does not look like a Requstory key/);
});

test("map waits for the job and prints the map link", async () => {
  const { text, calls } = await cli(["map", "posthog.com"], {
    "POST /maps": { jobId: "j1", website: "https://posthog.com/", status: "queued" },
    "GET /maps/jobs/j1": [{ jobId: "j1", website: "https://posthog.com/", status: "running" }, { jobId: "j1", website: "https://posthog.com/", status: "complete", pagesRead: 6, mapId: "m1", mapUrl: "https://requstory.com/?project=m1" }],
  }, { REQUSTORY_API_KEY: KEY });
  assert.deepEqual(calls[0].body, { website: "posthog.com" });
  assert.match(text, /complete · 6 pages read/);
  assert.match(text, /Open: https:\/\/requstory.com\/\?project=m1/);
});

test("ask sends the question and --ai; --json prints raw JSON", async () => {
  const { text, calls } = await cli(["ask", "m1", "who", "owns", "billing?", "--ai", "--json"], { "POST /maps/m1/ask": { answer: "Finance.", citations: [] } }, { REQUSTORY_API_KEY: KEY });
  assert.deepEqual(calls[0].body, { question: "who owns billing?", ai: true });
  assert.deepEqual(JSON.parse(text), { answer: "Finance.", citations: [] });
});

test("API errors carry the server's code and message", async () => {
  const client = createClient({ fetch: fakeFetch({ "GET /maps": { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "Send your API key" } } } }).fetch });
  await assert.rejects(client.maps(), (e) => e.status === 401 && e.code === "UNAUTHENTICATED" && /Send your API key/.test(e.message));
});

test("waitFor stops when the status settles or time runs out", async () => {
  let n = 0;
  const done = await waitFor(async () => ({ status: ++n < 3 ? "running" : "done" }), { sleep: async () => {} });
  assert.equal(done.status, "done");
  const late = await waitFor(async () => ({ status: "running" }), { seconds: 0, sleep: async () => {} });
  assert.equal(late.status, "running");
});
