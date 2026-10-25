# requstory

Requstory from the command line. Map how a company works from its public website (customer journey, teams, processes, handoffs), find the gaps, ask questions, and check public ease scores and AI-agent readiness.

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
