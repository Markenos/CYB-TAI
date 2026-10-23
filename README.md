# Akahu MCP — hook your NZ bank accounts up to an AI

An [MCP](https://modelcontextprotocol.io) server that connects Claude (or any MCP client) to your New Zealand bank, credit card, KiwiSaver and investment accounts through [Akahu](https://www.akahu.nz), NZ's open-finance platform.

Once it's set up you can ask things like:

- "What's my total balance across everything?"
- "Where did my money go last month?" / "How much did I spend at Countdown and New World since July?"
- "Find any subscriptions I'm paying for."
- "Have I been paid yet?" (pending + settled transactions)
- *(if you turn payments on)* "Shift $200 from Everyday to Savings."

It runs locally on your machine over stdio. Your tokens stay in your MCP client config and are only sent to `api.akahu.io`.

## 1. Get your Akahu tokens

1. Sign up at **[my.akahu.nz](https://my.akahu.nz)** and connect your banks (ANZ, ASB, BNZ, Westpac, Kiwibank, TSB, Co-op, Rabobank, plus KiwiSaver/investment providers, etc.).
2. Go to **Developers** and create a **Personal App**. Akahu needs you to verify your identity and turn on MFA first.
3. Copy the **App Token** (`app_token_...`) and **User Token** (`user_token_...`).
4. *(Optional)* To let the AI make payments or transfers, enable those permissions on your Personal App in Akahu. They're **off by default**, and this server keeps them off too unless you set `AKAHU_ENABLE_PAYMENTS=true`.

> ⚠️ The user token gives read access to **all** your connected financial data. Treat it like a password. Don't commit it or paste it into chats. If it leaks, revoke it at my.akahu.nz.

## 2. Build

Requires Node.js 18+.

```bash
git clone https://github.com/markenos/cyb-tai.git akahu-mcp
cd akahu-mcp
npm install
npm run build
```

## 3. Add it to your AI client

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "akahu": {
      "command": "node",
      "args": ["/absolute/path/to/akahu-mcp/dist/index.js"],
      "env": {
        "AKAHU_APP_TOKEN": "app_token_...",
        "AKAHU_USER_TOKEN": "user_token_..."
      }
    }
  }
}
```

Restart Claude Desktop. Akahu's tools should show up in the tools menu.

### Claude Code

```bash
claude mcp add akahu \
  -e AKAHU_APP_TOKEN=app_token_... \
  -e AKAHU_USER_TOKEN=user_token_... \
  -- node /absolute/path/to/akahu-mcp/dist/index.js
```

### Anything else

It's a standard stdio MCP server: run `node dist/index.js` with the env vars below.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `AKAHU_APP_TOKEN` | *required* | Personal App token |
| `AKAHU_USER_TOKEN` | *required* | Personal App user token |
| `AKAHU_ENABLE_PAYMENTS` | `false` | When `true`, the payment/transfer tools are registered. When `false` they don't exist at all. |
| `AKAHU_MAX_PAYMENT_NZD` | `500` | Hard cap per payment or transfer |
| `AKAHU_ALLOWED_PAYEES` | *(none)* | Comma-separated NZ account numbers. If set, payments can only go to these. Doesn't affect transfers between your own accounts. |

## Tools

**Read-only (always available)**

| Tool | What it does |
|---|---|
| `get_me` | Who's connected |
| `list_accounts` | All accounts with balances, institution, type and IDs |
| `get_account` | One account in detail, including loan terms and refresh times |
| `refresh_accounts` | Ask Akahu to pull fresh data from the bank(s) |
| `list_transactions` | Settled transactions for a date range, with merchant and category enrichment, paginated |
| `list_pending_transactions` | Not-yet-settled transactions |
| `search_transactions` | Filter by text, category, amount, direction or type |
| `spending_summary` | Money in and out grouped by category, category group, merchant, month or account |

Prompt: `monthly_budget_review` runs a guided review of a month's spending.

Dates such as `2026-10-01` are read as **NZ local time**, and end dates are inclusive. Negative amounts are money out.

**Money movement (only with `AKAHU_ENABLE_PAYMENTS=true`)**

| Tool | What it does |
|---|---|
| `list_payments` / `get_payment` / `list_transfers` | History and status of Akahu-initiated payments and transfers |
| `prepare_payment` | Step 1: validates a payment to an NZ account and returns a summary plus a `confirmation_id`. **Sends nothing.** |
| `prepare_transfer` | Step 1 for moving money between your own accounts |
| `confirm_money_movement` | Step 2: sends exactly what was prepared |
| `cancel_payment` | Cancel a payment that hasn't gone out yet |

### How payments are guarded

1. **Off by default**: the tools aren't even visible unless you opt in.
2. **Two steps**: the AI has to `prepare_*` first and show you the summary. The confirm tool's description tells it to only proceed after you explicitly say yes.
3. **Tamper-proof**: the confirm step sends the *stored* request, so the details can't change between your approval and sending. Confirmation IDs are single-use and expire after 5 minutes.
4. **Limits**: the per-payment cap, the optional payee allow-list, an available-balance check, and Akahu's own account capability checks.
5. **No double-paying**: the confirmation ID is sent as Akahu's idempotency key.
6. **Client prompts**: `confirm_money_movement` and `cancel_payment` are marked `destructiveHint`, so clients like Claude ask before running them.
7. Your bank's and Akahu's own payment limits and approvals still apply on top of all this.

Even with all that in place, an AI moving real money is a risk. Keep the cap low and use the allow-list.

## Limitations

- **Personal Apps are for your own accounts only.** Akahu says they're for personal use, not production apps. Offering this as a hosted, multi-user connector (people click "Connect" and log in with Akahu OAuth) needs an Akahu **Full App**, which goes through Akahu's approval process, plus hosting and secure token storage.
- Akahu refreshes bank data periodically. Use `refresh_accounts` if something looks stale.
- `search_transactions` and `spending_summary` look at no more than 1000 transactions per call. Narrow the date range for big histories.

## Development

```bash
npm run build      # compile to dist/
npm test           # vitest unit + in-memory MCP integration tests (no network)
npx @modelcontextprotocol/inspector node dist/index.js   # poke at it interactively
```

Code layout: `src/config.ts` (env), `src/akahu.ts` (SDK wrapper, error mapping, shaping), `src/format.ts` (NZD, NZ dates, account numbers), `src/guards.ts` (payment confirmation store), `src/tools/*` (MCP tools), `src/server.ts` (wiring).

Built on the official [`akahu`](https://www.npmjs.com/package/akahu) SDK and [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk). Not affiliated with Akahu.
