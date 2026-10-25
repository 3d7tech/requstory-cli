import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

Options
  --json                    Print the raw JSON reply
  --no-wait                 Do not wait for map or readiness results
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
  const args = [];
  for (const a of argv) {
    if (a.startsWith("--")) flags.add(a.slice(2));
    else args.push(a);
  }
  return { command: args[0], args: args.slice(1), flags };
}

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
  ask: (r) =>
    `${r.answer}\n` +
    (r.citations?.length ? "\nSources:\n" + r.citations.map((c) => `  - ${c.url ?? "From this map"}${c.excerpt ? `: "${c.excerpt}"` : ""}`).join("\n") + "\n" : ""),
};

export async function run(argv, { env = process.env, out = (s) => process.stdout.write(s), fetch, sleep } = {}) {
  const { command, args, flags } = parseArgs(argv);
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
    default:
      throw new RequstoryError(0, "USAGE", `Unknown command "${command}". Run requstory --help.`);
  }
}
