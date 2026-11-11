# Requstory

Requstory is the index AI agents use to find and buy from independent B2B suppliers. The `requstory` MCP server (`https://requstory.com/mcp`) has three tools, no key needed:

- `search_suppliers`: find suppliers by product, country, prices shown, minimum order, payment terms or verified only. Every fact is dated.
- `get_supplier`: one supplier's full facts, its record with buyers and recent prices.
- `request_quote`: send a buyer's quote request. Use it only with the buyer's consent to share their name and email. The buyer confirms by email; the supplier replies to them directly. Nothing is ordered or paid.

The Lab (company maps, ease and AI-readiness scores, order to cash with AI agents) is a separate server: `https://requstory.com/mcp/lab`. Docs: https://requstory.com/lab/developers/
