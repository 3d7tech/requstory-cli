---
name: requstory
description: Requstory is the index AI agents use to find and buy from independent B2B suppliers (wholesalers, distributors, manufacturers in the UK and US). Search suppliers by product, country, prices, minimum order and payment terms; read one supplier's dated trade facts and record with buyers; send a buyer's quote request with their consent. Use when the user wants to buy goods for a business, find a wholesaler or trade supplier, compare minimum orders or payment terms, or get a quote. Also (the Lab) maps how a company works from its website, checks ease and AI-readiness scores, and runs B2B order to cash with AI agents.
homepage: https://requstory.com/suppliers/
metadata: {"openclaw":{"primaryEnv":"REQUSTORY_API_KEY"}}
---

# Requstory

Requstory is the index AI agents use to find and buy from independent B2B suppliers. Every supplier has dated trade facts: prices shown or quote on request, minimum order (with amount), payment terms, delivery and returns, trade account link, and whether an agent could order online. Verified suppliers confirmed their own facts and rank first.

Base URL: `https://requstory.com/api/public/v1`. JSON in and out. Errors are `{"error": {"code", "message"}}`. The Index needs no key.

## Find and buy from suppliers

- Search: `GET /suppliers?q=<product or name>` with optional `country` (GB, UK, US), `prices` (any, shown, quote), `maxMinimumOrder`, `payOnAccount`, `verifiedOnly`, `limit` (up to 25). Each result has a `supplier` value (its website domain).
- One supplier: `GET /suppliers/{supplier}`: every dated fact, `track` (answered, usual hours to answer, orders that arrived) and `recentPrices`.
- Quote: `POST /suppliers/{supplier}/quotes {"items", "quantity", "deliverTo", "buyerName", "buyerEmail", "buyerCompany", "message"}`. The buyer gets an email link; the request reaches the supplier once they click it, and the supplier replies to the buyer by email.

```sh
curl "https://requstory.com/api/public/v1/suppliers?q=compostable+cups&country=GB"
curl https://requstory.com/api/public/v1/suppliers/ukpackaging.com
```

Rules:
- Quote each fact with its date. Never invent prices, minimums or terms; say "quote on request" when the supplier shows none.
- Send a quote request only after the buyer agrees to share their name and email with that supplier. Nothing is ordered or paid.
- MCP: the same three tools (`search_suppliers`, `get_supplier`, `request_quote`) at `https://requstory.com/mcp`.

# The Lab

The Lab reads a company's public website and drafts its operating model: the customer journey, teams in three bands, processes and handoffs. It scores how easy the company is to do business with and lists the gaps, each with proof. Its MCP server is `https://requstory.com/mcp/lab`.

## Setup (Lab account tools)

1. Sign up free with Google at https://requstory.com/?ref=clawhub
2. Open Profile → API keys → Create key. The key starts with `rqs_` and is shown once.
3. Set `REQUSTORY_API_KEY` to the key. Send it as `Authorization: Bearer $REQUSTORY_API_KEY`.

The Index and the Lab's public endpoints (companies, scores, AI readiness) work without a key.

## Which call to use

- Known company, want its score and gaps: `GET /companies?q=<name>` → take `slug` → `GET /companies/{slug}`.
- Any website, quick check of AI-agent readiness: `POST /ai-readiness {"website"}`, then `GET /ai-readiness/{domain}` until `status` is `done`.
- Any website, full map (key): `POST /maps {"website"}` → poll `GET /maps/jobs/{jobId}` every ~5 s until `status` is `complete` → `GET /maps/{mapId}`.
- Question about a saved map (key): `POST /maps/{mapId}/ask {"question"}`. Free answers cite website pages. Add `"ai": true` only if the user agrees to use credits.
- List saved maps: `GET /maps`. Account and limits: `GET /account`.

## Examples

```sh
curl "https://requstory.com/api/public/v1/companies?q=posthog"
curl https://requstory.com/api/public/v1/companies/posthog-com

curl -X POST https://requstory.com/api/public/v1/maps \
  -H "Authorization: Bearer $REQUSTORY_API_KEY" -H "Content-Type: application/json" \
  -d '{"website":"example.com"}'
curl https://requstory.com/api/public/v1/maps/jobs/<jobId> -H "Authorization: Bearer $REQUSTORY_API_KEY"
curl https://requstory.com/api/public/v1/maps/<mapId> -H "Authorization: Bearer $REQUSTORY_API_KEY"
```

## Reading results

- `GET /companies/{slug}`: `score.total` (0–100), `score.parts` (find and understand, get started online, get help, AI-agent ready), `gaps` sorted by `cost` (points lost) with `proof`.
- `GET /maps/{mapId}`: `journey`, `teams` (owner, processes), `missingOwners`, `peerChecks` (things most peers show that this site does not), `agentReady` gaps, `fixes`, `url` to open the map in the app.
- Never invent owners, numbers or teams. Report what the map says and link `url` so the user can check.

## Limits

10 calls a minute without a key, 60 with one. 5 new maps a day per account. 3 new AI-readiness checks an hour. On `429`, wait and retry later.

## Order to cash (MCP server)

Four agents run a B2B store's order to cash: read orders, check stock and credit, pick lists, invoices and their emails, match bank lines to invoices, chase late payers, handle returns. They stop and ask the founder about credit limits, short stock, packing, reminders, unclear payments and returns.

Tools on `https://requstory.com/mcp/lab`: `start_o2c_demo` (no key) or `start_o2c_run` (the business's own data, key, uses credits) → `advance_o2c_run` → `list_o2c_exceptions` → `resolve_o2c_exception` → `advance_o2c_run` again; `get_o2c_order` and `export_o2c_run` for the record. CLI: `requstory o2c …`.

- Show each exception to the user and resolve it only with the choice they make. Never pick one yourself.
- Sums, dates, stock and credit come from code; report them as given. Nothing is sent: emails are drafts in the export.
- Business runs are deleted 2 days after the last change. Each order is $1.00 (100 credits) from the account's credits, model cost included, charged once.
- Resources: `requstory://o2c/guide` explains the agents, approval rules and price; `requstory://o2c/runs/{runId}/log` and `/results` hold a run's record.

## Also available

- MCP servers: `https://requstory.com/mcp` (the Index) and `https://requstory.com/mcp/lab` (the Lab)
- CLI: `npx requstory --help`
- Index: https://requstory.com/suppliers/
- OpenAPI: https://requstory.com/api/public/v1/openapi.json
