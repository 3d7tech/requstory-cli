# Requstory

The `requstory` MCP server maps how a company works from its public website: teams, processes, handoffs, the customer journey, who owns each process and which steps an AI agent can run.

- Public tools need no key: search company maps, read ease and AI-readiness scores, check a website's AI-agent readiness.
- Account tools (map a website, read a saved map, ask about it) need an API key from https://requstory.com (Profile → API keys). Set it as the `Authorization: Bearer rqs_…` header.
- Order to cash: four agents run a B2B store's orders, shipping, invoices and payments, and returns. Start with `start_o2c_demo` (no key) or `start_o2c_run` (own data, key), then `advance_o2c_run`, `list_o2c_exceptions` and `resolve_o2c_exception`. Show every exception to the user and resolve it only with their choice.
- Docs: https://requstory.com/developers/api/
