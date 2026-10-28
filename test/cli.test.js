import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
  assert.deepEqual(parseArgs(["ask", "id", "who", "owns", "billing", "--ai"]), { command: "ask", args: ["id", "who", "owns", "billing"], flags: new Set(["ai"]), options: {} });
  assert.deepEqual(parseArgs(["o2c", "run", "r1", "--steps=5"]).options, { steps: "5" });
});

test("help lists every command", async () => {
  const { text } = await cli(["--help"], {});
  for (const c of ["login", "companies", "score", "readiness", "map", "job", "maps", "show", "ask", "o2c demo", "o2c start", "o2c run", "o2c exceptions", "o2c decide", "o2c order", "o2c export"]) assert.match(text, new RegExp(`\\b${c}\\b`));
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

/** A fake MCP server: routes tool names to structured results (a string is a tool error), and records the calls. */
function fakeMcp(tools) {
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(url, "https://requstory.com/mcp");
    const body = JSON.parse(init.body);
    calls.push({ tool: body.params.name, args: body.params.arguments, headers: init.headers });
    const reply = tools[body.params.name];
    const next = Array.isArray(reply) ? reply.shift() : reply;
    const result = typeof next === "string" ? { content: [{ type: "text", text: next }], isError: true } : { content: [], structuredContent: next, isError: false };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  };
  return { fetch, calls };
}

async function o2c(argv, tools, env = {}) {
  const { fetch, calls } = fakeMcp(tools);
  let text = "";
  const dir = await mkdtemp(join(tmpdir(), "requstory-"));
  await run(["o2c", ...argv], { env: { XDG_CONFIG_HOME: dir, ...env }, out: (s) => (text += s), fetch });
  return { text, calls, dir };
}

const board = (over = {}) => ({ day: 1, days: 30, done: false, stopped: null, exceptions: 0, orders: [], totals: { arrived: 1, shipped: 0, paid: 0, modelCostUsd: 0.0002, ordersBilled: 0, billedUsd: 0 }, events: [], ...over });

test("o2c demo needs no key; run keeps going until the agents need the founder", async () => {
  const { text, calls } = await o2c(["demo"], { start_o2c_demo: { runId: "r1", company: "Harbour & Home (made up)", orders: 12, model: "Gemma 4 26B", keptFor: "2 days" } });
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.match(text, /Run r1: Harbour & Home/);
  assert.match(text, /Next: requstory o2c run r1/);

  const step = (t, ex) => board({ exceptions: ex, events: [{ day: 1, t: "agent", agent: "Ecommerce agent", o: "#1041", text: t }] });
  const ran = await o2c(["run", "r1"], { advance_o2c_run: [step("Read the order", 0), step("Pick list", 1)] });
  assert.equal(ran.calls.length, 2);
  assert.deepEqual(ran.calls[0].args, { runId: "r1", steps: 20 });
  assert.match(ran.text, /Ecommerce agent · #1041: Read the order\n.*Pick list/);
  assert.match(ran.text, /1 waiting for you/);
  const once = await o2c(["run", "r1", "--steps=3"], { advance_o2c_run: [step("a", 0), step("b", 0)] });
  assert.equal(once.calls.length, 1);
  assert.equal(once.calls[0].args.steps, 3);
});

test("o2c exceptions lists choices and decide sends the founder's choice", async () => {
  const { text } = await o2c(["exceptions", "r1"], {
    list_o2c_exceptions: { exceptions: [{ exceptionId: "credit-1044-9", process: "orders", question: "Accept the order?", choices: [{ choice: "accept", label: "Accept" }, { choice: "decline", label: "Decline" }] }] },
  });
  assert.match(text, /credit-1044-9 {2}\[orders\] Accept the order\?\n {4}accept\s+Accept\n {4}decline\s+Decline/);
  const { calls } = await o2c(["decide", "r1", "reminder-1052-40", "send", "Please", "pay", "today."], { resolve_o2c_exception: board() }, { REQUSTORY_API_KEY: KEY });
  assert.deepEqual(calls[0].args, { runId: "r1", exceptionId: "reminder-1052-40", choice: "send", text: "Please pay today." });
  assert.equal(calls[0].headers.Authorization, "Bearer " + KEY);
  await assert.rejects(o2c(["decide", "r1", "x", "nope"], { resolve_o2c_exception: 'That exception was already resolved, or "choice" is not one of its choices.' }), (e) => e.code === "TOOL_ERROR" && /already resolved/.test(e.message));
});

test("o2c start sends the business with order scans as base64", async () => {
  const dir = await mkdtemp(join(tmpdir(), "requstory-biz-"));
  await writeFile(join(dir, "scan.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  await writeFile(join(dir, "business.json"), JSON.stringify({ company: "Bay Glassworks", customers: [{ name: "Garcia Inc" }], orders: [{ file: "scan.jpg" }, { name: "email", text: "PO 7" }], approvals: { ordersOver: 500 } }));
  const { text, calls } = await o2c(["start", join(dir, "business.json"), "--map=m1"], {
    start_o2c_run: { runId: "r2", company: "Bay Glassworks", model: "Gemma 4 26B", price: "$1.00 an order (100 credits), model cost included", read: { customers: 1, orders: 2 }, keptFor: "2 days after the last change" },
  }, { REQUSTORY_API_KEY: KEY });
  const sent = calls[0].args;
  assert.equal(sent.mapId, "m1");
  assert.deepEqual(sent.business.orders[0], { imageBase64: "/9j/4A==", name: "scan.jpg" });
  assert.deepEqual(sent.business.approvals, { ordersOver: 500 });
  assert.match(text, /Read: 1 customers, 2 orders/);
  assert.match(text, /Price: \$1.00 an order/);
  const billed = await o2c(["run", "r2", "--steps=1"], { advance_o2c_run: board({ totals: { arrived: 2, shipped: 2, paid: 1, modelCostUsd: 0.001, ordersBilled: 3, billedUsd: 3 } }) }, { REQUSTORY_API_KEY: KEY });
  assert.match(billed.text, /3 orders billed \(\$3\)/);
  await writeFile(join(dir, "bad.json"), JSON.stringify({ orders: [{ file: "order.pdf" }] }));
  await assert.rejects(o2c(["start", join(dir, "bad.json")], {}), /JPEG or PNG/);
});

test("o2c export prints the ledger or saves the files", async () => {
  const results = {
    company: "Bay Glassworks", done: true, note: "Nothing is sent.",
    ledger: [{ order: "#2001", invoice: "501", customer: "Garcia, Inc", total: 231.37, paid: 0, credit: 0, owed: 231.37, due: "2026-11-27", status: "invoiced" }],
    emails: [{ to: "ap@garcia.example", subject: "Invoice 501", body: "Attached.", attach: "invoice-501.pdf" }],
    pickLists: [], decisions: [{ day: 1, process: "ship", order: "#2001", decision: "Pick and pack → Packed", by: "mcp" }], meter: [{ kind: "invoiced", order: "#2001", day: 1 }],
  };
  const { text } = await o2c(["export", "r2"], { export_o2c_run: results });
  assert.match(text, /#2001\s+501\s+Garcia, Inc\s+total 231.37\s+owed 231.37\s+invoiced/);
  assert.match(text, /Billable: invoiced/);
  const dir = await mkdtemp(join(tmpdir(), "requstory-out-"));
  await o2c(["export", "r2", "--out=" + dir], { export_o2c_run: results });
  assert.match(await readFile(join(dir, "ledger.csv"), "utf8"), /#2001,501,"Garcia, Inc",231.37,0,0,231.37,2026-11-27,invoiced/);
  assert.match(await readFile(join(dir, "decisions.csv"), "utf8"), /1,ship,#2001,Pick and pack → Packed,mcp/);
  assert.match(await readFile(join(dir, "emails", "01.txt"), "utf8"), /^To: ap@garcia.example\nSubject: Invoice 501\nAttach: invoice-501.pdf\n\nAttached.\n$/);
});
