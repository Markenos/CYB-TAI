import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, safe, shapeAccount, type Context } from "../akahu.js";
import { formatNzd } from "../format.js";

export function registerAccountTools(server: McpServer, ctx: Context) {
  server.registerTool(
    "list_accounts",
    {
      title: "List bank accounts",
      description:
        "Lists every account the user has connected through Akahu (everyday, savings, credit cards, loans, KiwiSaver, investments) with balances, institution and account IDs. Call this first to get account IDs for other tools.",
      inputSchema: {
        include_inactive: z.boolean().default(false).describe("Include accounts Akahu can no longer access"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ include_inactive }) => {
      const accounts = (await ctx.akahu.accounts.list(ctx.token))
        .filter((a) => include_inactive || a.status === "ACTIVE")
        .map(shapeAccount);
      if (accounts.length === 0) {
        return ok("No accounts are connected. Connect banks at my.akahu.nz, then try again.", []);
      }
      const lines = accounts.map((a) => {
        const bal = a.balance ? formatNzd(a.balance.current) : "balance unavailable";
        const avail =
          a.balance?.available !== undefined && a.balance.available !== a.balance.current
            ? ` (available ${formatNzd(a.balance.available)})`
            : "";
        return `- ${a.name} [${a.institution}, ${a.type}] ${bal}${avail} - id ${a.id}`;
      });
      return ok(`${accounts.length} account(s):\n${lines.join("\n")}`, accounts);
    }),
  );

  server.registerTool(
    "get_account",
    {
      title: "Get account details",
      description: "Full details for one account: balance, limits, loan terms, refresh times, and what it supports.",
      inputSchema: { account_id: z.string().min(1).describe("Akahu account ID (acc_...)") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ account_id }) => {
      const a = shapeAccount(await ctx.akahu.accounts.get(ctx.token, account_id));
      return ok(`${a.name} at ${a.institution}`, a);
    }),
  );

  server.registerTool(
    "refresh_accounts",
    {
      title: "Refresh bank data",
      description:
        "Asks Akahu to fetch fresh balances and transactions from the bank(s). Refreshes happen in the background and can take a minute; data from before the refresh is returned until then.",
      inputSchema: {
        account_id: z.string().optional().describe("Only refresh this account. Omit to refresh everything."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ account_id }) => {
      if (account_id) await ctx.akahu.accounts.refresh(ctx.token, account_id);
      else await ctx.akahu.accounts.refreshAll(ctx.token);
      return ok(`Refresh requested for ${account_id ?? "all accounts"}. Give it a minute before re-reading balances.`);
    }),
  );
}
