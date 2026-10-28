# requstory

Requstory from the command line. Map how a company works from its public website (customer journey, teams, processes, handoffs), find the gaps, ask questions, and check public ease scores and AI-agent readiness.

It also runs **order to cash for a B2B online store with four AI agents** (process orders, ship orders, invoice and collect payments, handle returns) that stop and ask you about credit limits, short stock, packing, reminders, unclear payments and returns.

- Website: https://requstory.com
- API and MCP docs: https://requstory.com/developers/api/
- MCP server: `https://requstory.com/mcp`

## Install

```sh
npm install -g requstory
# or run once
npx requstory --help
```

Node 20 or later. No dependencies.

## Quick start

```sh
# Public, no key needed
requstory companies posthog
requstory score posthog-com
requstory readiness example.com

# Your maps: create a key in your Requstory profile (API keys)
requstory login rqs_your_key
requstory map example.com
requstory maps
requstory show <mapId>
requstory ask <mapId> "Who owns billing?"
requstory ask <mapId> "What should we fix first?" --ai   # Requ AI, uses credits
```

Add `--json` to any command for the raw reply. The key can also come from `REQUSTORY_API_KEY`. `login` saves it to `~/.config/requstory/config.json` (readable only by you).

## Commands

| Command | What it does | Key |
| --- | --- | --- |
| `companies <query>` | Search mapped and scored companies | No |
| `score <slug>` | Ease score (0–100), ranking place and gaps | No |
| `readiness <website>` | Can AI agents read and use a website? | No |
| `map <website>` | Map a website and save it to your account (5 a day) | Yes |
| `job <jobId>` | Status of a map still running | Yes |
| `maps` | Your saved maps | Yes |
| `show <mapId> [--full]` | A map in brief, or the whole model | Yes |
| `ask <mapId> <question> [--ai]` | Answers with sources | Yes |
| `account` | Plan, credits and maps left today | Yes |
| `o2c demo` | Start the made-up store's month | No |
| `o2c start <business.json>` | Start a day of your own business | Yes |
| `o2c run / exceptions / decide / order / export` | Drive a run and get the record | Demo: no |

## Order to cash

```sh
# A month of a made-up store, no key needed
requstory o2c demo
requstory o2c run <runId>              # agents work until they need you
requstory o2c exceptions <runId>       # what they are asking
requstory o2c decide <runId> <exceptionId> accept
requstory o2c run <runId>
requstory o2c export <runId> --out=results

# A day of your own business (key; $1.00 an order from your credits, model cost included)
requstory o2c start business.json --map=<mapId>
```

`business.json` holds what the run page's folder holds. Every list is optional except customers:

```json
{
  "company": "Bay Glassworks", "symbol": "£", "vat": "20%", "termsDays": 30, "nextInvoiceNo": 501,
  "customers": [{ "id": "C01", "name": "Garcia Inc", "email": "ap@garcia.example", "creditLimit": 5000, "openBalance": 0 }],
  "products": [{ "sku": "GL-12", "name": "Pebbled goblet 12 oz", "price": 8.99, "stock": 40 }],
  "orders": [{ "file": "orders/po-7781.jpg" }, { "name": "email from Garcia", "text": "Please send 12 x Pebbled goblet 12 oz. PO 7782" }],
  "openInvoices": [{ "no": "INV-77", "customer": "Garcia Inc", "total": 240, "paid": 0, "due": "2026-10-20", "date": "2026-10-06" }],
  "bank": [{ "from": "GARCIA INC", "ref": "INV-77", "amount": 240 }],
  "returns": [{ "message": "The glasses on invoice INV-77 arrived broken." }],
  "returnsPolicy": "Damaged in transit: full refund or credit within 30 days.",
  "instructions": { "finance": "Sign emails \"Accounts team\"." },
  "approvals": { "ordersOver": 2000, "overCreditLimitUpTo": 100, "refundsUpTo": 50, "returnsWithinDays": 30, "shortPaymentWriteOffUpTo": 2 }
}
```

Order scans (`file`) are JPEG or PNG under 3 MB, relative to the JSON file. Without `approvals` the agents ask you about every credit overrun and refund; with them, orders above `ordersOver` always come to you, the code (not the model) lets through overruns up to `overCreditLimitUpTo` and refunds up to `refundsUpTo` whose amount it has worked out itself, returns for invoices older than `returnsWithinDays` (or with no `date`) always come to you, and a payment that leaves `shortPaymentWriteOffUpTo` or less owed closes the invoice. 0 means no rule. Each order is charged once, the first time it is invoiced, collected or has a return settled; a $10 credit pack covers 10 orders, and a run stops before an order your credits cannot pay for. Sums, dates, stock and credit are plain code. Nothing is sent: emails are drafts in the export. Runs are deleted 2 days after the last change.

## Use as a library

```js
import { createClient } from "requstory";

const requstory = createClient({ key: process.env.REQUSTORY_API_KEY });
const { companies } = await requstory.companies("stripe");
```

## Limits

10 calls a minute without a key, 60 with one. 5 new maps a day. 3 AI-readiness checks an hour.

## Licence

MIT © 3D7 Technologies Ltd
