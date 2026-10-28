import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createClient, DEFAULT_BASE, RequstoryError, waitFor } from "./client.js";

export const HELP = `requstory: map how a company works from its website and find the gaps

Usage: requstory <command> [options]

Account
  login <key>               Save your API key (create one at https://requstory.com/#profile)
  logout                    Forget the saved key
  account                   Plan, credits and maps left today

Public (no key needed)
  companies <query>         Search mapped and scored companies
  score <slug>              Ease score, ranking place and gaps for a company
  readiness <website>       Check whether AI agents can read and use a website

Your maps (key needed)
  map <website>             Map a website and save it to your account
  job <jobId>               Status of a map that is still running
  maps                      List your saved maps
  show <mapId> [--full]     A map in brief (--full for the whole model)
  ask <mapId> <question>    Ask about a map (--ai for a Requ AI answer, uses credits)

Order to cash: four AI agents run a B2B store's orders, shipping, invoices and returns
  o2c demo                  Start a month of the made-up Harbour & Home store (no key)
  o2c start <business.json> Start a day of your own business (key; uses credits)
  o2c run <runId>           Let the agents work until they need you (--steps=N for one call)
  o2c exceptions <runId>    What the agents are asking you, with the choices
  o2c decide <runId> <exceptionId> <choice> [text]
                            Answer one question (text: edited reminder wording)
  o2c order <runId> <order> One order's trail: what was read, invoiced, emailed and decided
  o2c export <runId>        Ledger, emails, pick lists and decisions (--out=<dir> to save files)

Options
  --json                    Print the raw JSON reply
  --no-wait                 Do not wait for map or readiness results
  --model=<id>, --map=<mapId>  For o2c demo and o2c start
  --help, --version

The key can also come from REQUSTORY_API_KEY. Docs: https://requstory.com/developers/api/`;

export function configPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "requstory", "config.json");
}

async function savedKey(env) {
  try {
    return JSON.parse(await readFile(configPath(env), "utf8")).key ?? null;
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  const args = [];
  for (const a of argv) {
    if (a.startsWith("--") && a.includes("=")) options[a.slice(2, a.indexOf("="))] = a.slice(a.indexOf("=") + 1);
    else if (a.startsWith("--")) flags.add(a.slice(2));
    else args.push(a);
  }
  return { command: args[0], args: args.slice(1), flags, options };
}

/**
 * A business folder as JSON (see `o2c start` in the README). An order may name a scan with "file" (a JPEG or PNG,
 * relative to the JSON file); it is sent as base64.
 */
export async function readBusiness(path) {
  let business;
  try {
    business = JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new RequstoryError(0, "USAGE", `Could not read ${path} as JSON: ${e.message}`);
  }
  for (const order of business.orders ?? []) {
    if (order && typeof order.file === "string") {
      const file = resolve(dirname(path), order.file);
      if (![".jpg", ".jpeg", ".png"].includes(extname(file).toLowerCase())) throw new RequstoryError(0, "USAGE", `${order.file}: order scans must be JPEG or PNG.`);
      order.imageBase64 = (await readFile(file)).toString("base64");
      order.name ??= order.file;
      delete order.file;
    }
  }
  return business;
}

const csv = (rows) => rows.map((r) => r.map((v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replaceAll('"', '""')}"` : String(v ?? ""))).join(",")).join("\n") + "\n";

const line = (label, value) => (value === null || value === undefined || value === "" ? "" : `${label}: ${value}\n`);

/** Plain-text views of each reply. */
export const views = {
  account: (a) => `${a.name} <${a.email}>\n` + line("Plan", a.plan) + line("Credits", a.credits) + line("Saved maps", a.maps) + line("Maps left today", a.mapsLeftToday),
  companies: (r) =>
    r.companies.length
      ? r.companies.map((c) => `${c.slug.padEnd(32)} ${String(c.score ?? "–").padStart(3)}  ${c.name} (${c.website})`).join("\n") + "\n"
      : "No companies found. Try readiness <website> or map <website>.\n",
  company: (c) =>
    `${c.name} · ${c.website}\n` +
    line("Ease score", c.score ? `${c.score.total}/100` : "not scored yet") +
    (c.score?.place ? line("Place", `${c.score.place.rank} of ${c.score.place.size}`) : "") +
    (c.gaps.length ? "Gaps (most costly first):\n" + c.gaps.map((g) => `  - ${g.text}${g.cost ? ` (−${g.cost})` : ""}`).join("\n") + "\n" : "No gaps found.\n") +
    line("Page", c.page),
  readiness: (r) =>
    `${r.domain}: ${r.status}` + (r.total ? ` · ${r.ready}/${r.total} ready` : "") + "\n" +
    r.items.map((i) => `  ${i.state === "ok" ? "✓" : i.state === "missing" ? "✗" : "·"} ${i.text}`).join("\n") + (r.items.length ? "\n" : "") +
    line("Error", r.error) + line("Page", r.page),
  job: (j) =>
    `${j.website}: ${j.status}` + (j.pagesRead ? ` · ${j.pagesRead} pages read` : "") + "\n" +
    line("Job", j.jobId) + line("Map", j.mapId) + line("Open", j.mapUrl) + (j.error ? line("Error", j.error.message) : ""),
  maps: (r) => (r.maps.length ? r.maps.map((m) => `${m.id}  v${m.version}  ${m.name}`).join("\n") + "\n" : "No saved maps yet. Try: requstory map <website>\n"),
  map: (m) =>
    `${m.name}` + (m.industry ? ` · ${m.industry}` : "") + ` · version ${m.version}\n` +
    (m.journey.length ? "Journey: " + m.journey.map((s) => s.stage).join(" → ") + "\n" : "") +
    "Teams:\n" + m.teams.map((t) => `  - ${t.name}${t.owner ? ` (owner: ${t.owner})` : ""}: ${t.processes.join(", ") || "no processes yet"}`).join("\n") + "\n" +
    (m.missingOwners.length ? line("No owner", m.missingOwners.join(", ")) : "") +
    (m.agentReady.length ? "AI-agent gaps:\n" + m.agentReady.map((i) => `  - ${i.text}`).join("\n") + "\n" : "") +
    line("Fixes", `${m.fixes.fixed} fixed, ${m.fixes.asked} asked`) + line("Open", m.url),
  o2cStart: (r) =>
    `Run ${r.runId}: ${r.company}\n` + line("Model", r.model) + (r.read ? line("Read", Object.entries(r.read).map(([k, n]) => `${n} ${k}`).join(", ")) : line("Orders", r.orders)) +
    line("Kept for", r.keptFor) + `Next: requstory o2c run ${r.runId}\n`,
  o2cRun: (r) =>
    (r.events ?? []).map((e) => `  day ${e.day} · ${e.agent ?? e.tool ?? e.t}${e.o ? " · " + e.o : ""}: ${e.text}`).join("\n") + (r.events?.length ? "\n" : "") +
    `Day ${r.day} of ${r.days}` + (r.done ? " · done" : "") + ` · ${r.totals.arrived} orders in, ${r.totals.shipped} shipped, ${r.totals.paid} paid` +
    ` · model cost $${r.totals.modelCostUsd}\n` + line("Stopped", r.stopped) +
    (r.exceptions ? `${r.exceptions} waiting for you. Run: requstory o2c exceptions <runId>\n` : ""),
  o2cExceptions: (r) =>
    r.exceptions.length
      ? r.exceptions.map((x) => `${x.exceptionId}  [${x.process}] ${x.question}\n` + x.choices.map((c) => `    ${c.choice.padEnd(20)} ${c.label}`).join("\n")).join("\n") +
        "\nAnswer with: requstory o2c decide <runId> <exceptionId> <choice>\n"
      : "Nothing is waiting for you.\n",
  o2cOrder: (o) =>
    `${o.id} · ${o.customer?.name ?? ""} · ${o.status}\n` + line("Their order", o.po) +
    (o.read?.lines?.length ? "Lines:\n" + o.read.lines.map((l) => `  ${l.qty} × ${l.item} @ ${o.symbol}${Number(l.unitPrice).toFixed(2)}`).join("\n") + "\n" : "") +
    (o.invoice ? line("Invoice", `${o.invoice.no}: ${o.symbol}${Number(o.invoice.total).toFixed(2)}, ${o.symbol}${Number(o.invoice.balance).toFixed(2)} owed`) : "") +
    "Steps:\n" + o.log.map((e) => `  day ${e.day} · ${e.agent ?? e.tool ?? e.t}: ${e.text}`).join("\n") + "\n",
  o2cExport: (r) =>
    `${r.company}${r.done ? "" : " (still running)"}\nLedger:\n` +
    r.ledger.map((l) => `  ${l.order.padEnd(6)} ${String(l.invoice).padEnd(10)} ${String(l.customer).padEnd(24)} total ${l.total}  owed ${l.owed}  ${l.status}`).join("\n") + "\n" +
    line("Emails to send", r.emails.length) + line("Decisions", r.decisions.length) + line("Billable", r.meter.map((m) => m.kind).join(", ")) + r.note + "\n",
  ask: (r) =>
    `${r.answer}\n` +
    (r.citations?.length ? "\nSources:\n" + r.citations.map((c) => `  - ${c.url ?? "From this map"}${c.excerpt ? `: "${c.excerpt}"` : ""}`).join("\n") + "\n" : ""),
};

/** Writes an export as files: results.json, ledger.csv, decisions.csv and one text file per email. */
async function saveExport(dir, r) {
  await mkdir(join(dir, "emails"), { recursive: true });
  await writeFile(join(dir, "results.json"), JSON.stringify(r, null, 2) + "\n");
  await writeFile(join(dir, "ledger.csv"), csv([["Order", "Invoice", "Customer", "Total", "Paid", "Credit", "Owed", "Due", "Status"], ...r.ledger.map((l) => [l.order, l.invoice, l.customer, l.total, l.paid, l.credit, l.owed, l.due, l.status])]));
  await writeFile(join(dir, "decisions.csv"), csv([["Day", "Process", "Order", "Decision", "By"], ...r.decisions.map((d) => [d.day, d.process, d.order, d.decision, d.by])]));
  await Promise.all(r.emails.map((m, k) => writeFile(join(dir, "emails", `${String(k + 1).padStart(2, "0")}.txt`), `To: ${m.to}\nSubject: ${m.subject}\n` + (m.attach ? `Attach: ${m.attach}\n` : "") + `\n${m.body}\n`)));
}

async function o2c(client, sub, args, { flags, options, show, out, need }) {
  const n = (k, usage) => need(k + 1, "o2c " + usage);
  switch (sub) {
    case "demo":
      return show(views.o2cStart, await client.o2c.demo({ model: options.model }));
    case "start":
      n(1, "start <business.json> [--map=<mapId>] [--model=<id>]");
      return show(views.o2cStart, await client.o2c.start(await readBusiness(args[1]), { mapId: options.map, model: options.model }));
    case "run": {
      n(1, "run <runId> [--steps=N]");
      // Without --steps, keep going (up to 10 calls) until the agents need the founder or the run ends.
      let r = await client.o2c.advance(args[1], { steps: options.steps ? Number(options.steps) : 20 });
      const events = [...r.events];
      for (let k = 1; k < 10 && !options.steps && !flags.has("no-wait") && !r.done && !r.stopped && !r.exceptions; k++) {
        r = await client.o2c.advance(args[1], { steps: 20 });
        events.push(...r.events);
      }
      return show(views.o2cRun, { ...r, events });
    }
    case "exceptions":
      n(1, "exceptions <runId>");
      return show(views.o2cExceptions, await client.o2c.exceptions(args[1]));
    case "decide":
      n(3, "decide <runId> <exceptionId> <choice> [text]");
      return show(views.o2cRun, await client.o2c.resolve(args[1], args[2], args[3], args.slice(4).join(" ") || undefined));
    case "order":
      n(2, "order <runId> <order>");
      return show(views.o2cOrder, await client.o2c.order(args[1], args[2]));
    case "export": {
      n(1, "export <runId> [--out=<dir>]");
      const r = await client.o2c.export(args[1]);
      if (options.out) {
        await saveExport(options.out, r);
        out(`Saved ${r.ledger.length} ledger rows, ${r.emails.length} emails and ${r.decisions.length} decisions to ${options.out}\n`);
        return;
      }
      return show(views.o2cExport, r);
    }
    default:
      throw new RequstoryError(0, "USAGE", "Usage: requstory o2c demo|start|run|exceptions|decide|order|export. Run requstory --help.");
  }
}

export async function run(argv, { env = process.env, out = (s) => process.stdout.write(s), fetch, sleep } = {}) {
  const { command, args, flags, options } = parseArgs(argv);
  if (!command || flags.has("help") || command === "help") {
    out(HELP + "\n");
    return 0;
  }
  if (flags.has("version")) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    out(pkg.version + "\n");
    return 0;
  }
  const need = (n, usage) => {
    if (args.length < n) throw new RequstoryError(0, "USAGE", "Usage: requstory " + usage);
  };
  if (command === "login") {
    need(1, "login <key>");
    if (!/^rqs_[A-Za-z0-9]{40}$/.test(args[0])) throw new RequstoryError(0, "USAGE", "That does not look like a Requstory key (rqs_ + 40 characters).");
    const client = createClient({ key: args[0], base: env.REQUSTORY_API_BASE || DEFAULT_BASE, fetch });
    const account = await client.account();
    await mkdir(dirname(configPath(env)), { recursive: true });
    await writeFile(configPath(env), JSON.stringify({ key: args[0] }) + "\n", { mode: 0o600 });
    out(`Signed in as ${account.name} <${account.email}>. Key saved to ${configPath(env)}\n`);
    return 0;
  }
  if (command === "logout") {
    await rm(configPath(env), { force: true });
    out("Key removed.\n");
    return 0;
  }
  const key = env.REQUSTORY_API_KEY || (await savedKey(env));
  const client = createClient({ key, base: env.REQUSTORY_API_BASE || DEFAULT_BASE, fetch });
  const wait = !flags.has("no-wait");
  const show = (view, data) => out(flags.has("json") ? JSON.stringify(data, null, 2) + "\n" : view(data));
  switch (command) {
    case "account":
    case "whoami":
      return show(views.account, await client.account()), 0;
    case "companies":
    case "search":
      return show(views.companies, await client.companies(args.join(" "))), 0;
    case "score":
      need(1, "score <slug>");
      return show(views.company, await client.company(args[0])), 0;
    case "readiness": {
      need(1, "readiness <website>");
      const started = await client.startReadiness(args[0]);
      const result = wait ? await waitFor(() => client.readiness(started.domain), { seconds: 90, sleep }) : started;
      return show(views.readiness, result), 0;
    }
    case "map": {
      need(1, "map <website>");
      const started = await client.startMap(args[0]);
      const result = wait ? await waitFor(() => client.job(started.jobId), { seconds: 180, sleep }) : started;
      return show(views.job, result), 0;
    }
    case "job":
      need(1, "job <jobId>");
      return show(views.job, await client.job(args[0])), 0;
    case "maps":
      return show(views.maps, await client.maps()), 0;
    case "show":
      need(1, "show <mapId> [--full]");
      return show(views.map, await client.map(args[0], { full: flags.has("full") })), 0;
    case "ask":
      need(2, "ask <mapId> <question> [--ai]");
      return show(views.ask, await client.ask(args[0], args.slice(1).join(" "), { ai: flags.has("ai") })), 0;
    case "o2c":
      return await o2c(client, args[0], args, { flags, options, show, out, need }), 0;
    default:
      throw new RequstoryError(0, "USAGE", `Unknown command "${command}". Run requstory --help.`);
  }
}
