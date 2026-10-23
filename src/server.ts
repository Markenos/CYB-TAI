import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Context } from "./akahu.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerIdentityTools } from "./tools/identity.js";
import { registerPaymentTools } from "./tools/payments.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { VERSION } from "./version.js";

export function buildServer(ctx: Context): McpServer {
  const server = new McpServer(
    { name: "akahu", title: "Akahu (NZ banking)", version: VERSION },
    {
      instructions:
        "Access to the user's New Zealand bank, credit card, KiwiSaver and investment accounts via Akahu. " +
        "Amounts are NZD; negative transaction amounts are money out. Dates are interpreted in NZ time. " +
        "Start with list_accounts to get account IDs. " +
        (ctx.config.enablePayments
          ? "Payments and transfers are two-step: prepare_* returns a summary; only call confirm_money_movement after the user explicitly approves that summary."
          : "Payments are disabled; this connection is read-only."),
    },
  );

  registerIdentityTools(server, ctx);
  registerAccountTools(server, ctx);
  registerTransactionTools(server, ctx);
  if (ctx.config.enablePayments) registerPaymentTools(server, ctx);

  server.registerPrompt(
    "monthly_budget_review",
    {
      title: "Monthly budget review",
      description: "Review a month's spending by category and suggest where to cut back.",
      argsSchema: { month: z.string().optional().describe("Month as YYYY-MM. Defaults to last month.") },
    },
    ({ month }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Do a budget review of my spending for ${month ?? "last month"} (NZ time). ` +
              "Use spending_summary grouped by category_group and by category, compare against the month before, " +
              "call out the biggest categories and any unusual or recurring charges (subscriptions, fees), " +
              "and suggest 3 realistic ways to save. Keep it practical and in NZD.",
          },
        },
      ],
    }),
  );

  return server;
}
