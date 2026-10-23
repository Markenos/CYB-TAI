import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Account, PaymentCreateParams } from "akahu";
import { z } from "zod";
import { fail, ok, safe, type Context } from "../akahu.js";
import { formatNzd, normaliseAccountNumber, toAkahuTimestamp } from "../format.js";
import { ConfirmationStore, MAX_REF_LENGTH, toCents, validateAmount } from "../guards.js";

const ref = z.string().max(MAX_REF_LENGTH).optional();

const CONFIRM_HINT =
  "Show the user this summary and ask them to approve it. Only call confirm_money_movement after they explicitly say yes.";

function availableBalance(a: Account): number | undefined {
  return a.balance?.available ?? a.balance?.current;
}

function insufficient(a: Account, amount: number): string | null {
  const avail = availableBalance(a);
  if (avail !== undefined && avail < amount)
    return `Insufficient funds: ${a.name} has ${formatNzd(avail)} available, payment is ${formatNzd(amount)}.`;
  return null;
}

export function registerPaymentTools(server: McpServer, ctx: Context, store = new ConfirmationStore()) {
  const rangeShape = {
    start: z.string().optional().describe("Start date (YYYY-MM-DD) or ISO timestamp"),
    end: z.string().optional().describe("End date, inclusive"),
  };
  const range = (start?: string, end?: string) => ({
    start: start ? toAkahuTimestamp(start) : undefined,
    end: end ? toAkahuTimestamp(end, true) : undefined,
  });

  server.registerTool(
    "list_payments",
    {
      title: "List payments",
      description: "Payments made through Akahu (not all bank payments - only ones this app initiated), with status.",
      inputSchema: rangeShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ start, end }) => {
      const payments = await ctx.akahu.payments.list(ctx.token, range(start, end));
      return ok(`${payments.length} payment(s)`, payments);
    }),
  );

  server.registerTool(
    "get_payment",
    {
      title: "Get payment status",
      description: "Status and timeline of one Akahu payment.",
      inputSchema: { payment_id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ payment_id }) => {
      const p = await ctx.akahu.payments.get(ctx.token, payment_id);
      return ok(`Payment ${p._id}: ${p.status}${p.status_text ? ` - ${p.status_text}` : ""}`, p);
    }),
  );

  server.registerTool(
    "list_transfers",
    {
      title: "List transfers",
      description: "Transfers between the user's own accounts made through Akahu, with status.",
      inputSchema: rangeShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ start, end }) => {
      const transfers = await ctx.akahu.transfers.list(ctx.token, range(start, end));
      return ok(`${transfers.length} transfer(s)`, transfers);
    }),
  );

  server.registerTool(
    "prepare_payment",
    {
      title: "Prepare a payment (does not send)",
      description:
        "Step 1 of 2 for paying someone else's NZ bank account. Validates the details, checks limits and balance, and returns a summary plus a confirmation_id. NOTHING is sent until confirm_money_movement is called with that ID after the user explicitly approves.",
      inputSchema: {
        from_account_id: z.string().min(1).describe("Akahu account ID to pay from (see list_accounts)"),
        amount: z.number().positive().describe("Amount in NZD"),
        payee_name: z.string().min(1).max(64).describe("Name of the person/business being paid"),
        payee_account_number: z.string().describe("NZ bank account number, e.g. 12-3456-7890123-00"),
        their_particulars: ref.describe("Shown on the payee's statement (max 12 chars)"),
        their_code: ref.describe("Shown on the payee's statement (max 12 chars)"),
        their_reference: ref.describe("Shown on the payee's statement (max 12 chars)"),
        your_code: ref.describe("Shown on your statement (max 12 chars)"),
        your_reference: ref.describe("Shown on your statement (max 12 chars)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async (input) => {
      const amountErr = validateAmount(input.amount, ctx.config.maxPaymentNzd);
      if (amountErr) return fail(amountErr);
      const a = { ...input, amount: toCents(input.amount) };

      const to = normaliseAccountNumber(a.payee_account_number);
      if (!to) return fail(`"${a.payee_account_number}" isn't a valid NZ account number (expected e.g. 12-3456-7890123-00).`);
      if (ctx.config.allowedPayees && !ctx.config.allowedPayees.has(to))
        return fail(`${to} isn't on the AKAHU_ALLOWED_PAYEES allow-list, so this payment is blocked.`);

      const from = await ctx.akahu.accounts.get(ctx.token, a.from_account_id);
      if (!from.attributes.includes("PAYMENT_FROM"))
        return fail(`${from.name} (${from.connection?.name}) doesn't support making payments via Akahu.`);
      const funds = insufficient(from, a.amount);
      if (funds) return fail(funds);

      const params: PaymentCreateParams = {
        from: from._id,
        amount: a.amount,
        to: { name: a.payee_name, account_number: to },
        meta: {
          source: { code: a.your_code, reference: a.your_reference },
          destination: { particulars: a.their_particulars, code: a.their_code, reference: a.their_reference },
        },
      };
      const refs = [a.their_particulars, a.their_code, a.their_reference].filter(Boolean).join(" / ");
      const summary =
        `PAY ${formatNzd(a.amount)} to ${a.payee_name} (${to})\n` +
        `from ${from.name} at ${from.connection?.name}${from.formatted_account ? ` (${from.formatted_account})` : ""}` +
        (refs ? `\nTheir statement: ${refs}` : "");
      const { id, expiresAt } = store.add({ kind: "payment", params, summary });
      return ok(`${summary}\n\n${CONFIRM_HINT}`, {
        confirmation_id: id,
        expires_at: new Date(expiresAt).toISOString(),
        summary,
      });
    }),
  );

  server.registerTool(
    "prepare_transfer",
    {
      title: "Prepare a transfer (does not send)",
      description:
        "Step 1 of 2 for moving money between the user's own connected accounts. Returns a summary and confirmation_id; nothing moves until confirm_money_movement is called after the user approves.",
      inputSchema: {
        from_account_id: z.string().min(1),
        to_account_id: z.string().min(1),
        amount: z.number().positive().describe("Amount in NZD"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async (input) => {
      const amountErr = validateAmount(input.amount, ctx.config.maxPaymentNzd);
      if (amountErr) return fail(amountErr);
      const a = { ...input, amount: toCents(input.amount) };
      if (a.from_account_id === a.to_account_id) return fail("From and to accounts are the same.");

      const [from, to] = await Promise.all([
        ctx.akahu.accounts.get(ctx.token, a.from_account_id),
        ctx.akahu.accounts.get(ctx.token, a.to_account_id),
      ]);
      if (!from.attributes.includes("TRANSFER_FROM")) return fail(`${from.name} can't send transfers via Akahu.`);
      if (!to.attributes.includes("TRANSFER_TO")) return fail(`${to.name} can't receive transfers via Akahu.`);
      const funds = insufficient(from, a.amount);
      if (funds) return fail(funds);

      const summary = `TRANSFER ${formatNzd(a.amount)} from ${from.name} (${from.connection?.name}) to ${to.name} (${to.connection?.name})`;
      const { id, expiresAt } = store.add({
        kind: "transfer",
        params: { from: from._id, to: to._id, amount: a.amount },
        summary,
      });
      return ok(`${summary}\n\n${CONFIRM_HINT}`, {
        confirmation_id: id,
        expires_at: new Date(expiresAt).toISOString(),
        summary,
      });
    }),
  );

  server.registerTool(
    "confirm_money_movement",
    {
      title: "Send a prepared payment or transfer",
      description:
        "Step 2 of 2. Sends a payment or transfer exactly as prepared. ONLY call this after showing the user the prepare_* summary and getting their explicit approval in this conversation. Confirmation IDs are single-use and expire after 5 minutes.",
      inputSchema: { confirmation_id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    safe(async ({ confirmation_id }) => {
      const m = store.take(confirmation_id);
      if (!m) return fail("That confirmation ID is unknown, already used, or expired. Prepare the payment again.");
      // The confirmation ID doubles as the idempotency key so a retried request can't pay twice.
      const opts = { idempotencyKey: confirmation_id };
      if (m.kind === "payment") {
        const p = await ctx.akahu.payments.create(ctx.token, m.params, opts);
        return ok(`Payment submitted: ${m.summary}\nStatus: ${p.status}${p.status_text ? ` - ${p.status_text}` : ""}\nID: ${p._id}`, p);
      }
      const t = await ctx.akahu.transfers.create(ctx.token, m.params, opts);
      return ok(`Transfer submitted: ${m.summary}\nStatus: ${t.status}${t.status_text ? ` - ${t.status_text}` : ""}\nID: ${t._id}`, t);
    }),
  );

  server.registerTool(
    "cancel_payment",
    {
      title: "Cancel a payment",
      description: "Cancels an Akahu payment that hasn't been sent yet (e.g. status PENDING_APPROVAL or PAUSED).",
      inputSchema: { payment_id: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ payment_id }) => {
      await ctx.akahu.payments.cancel(ctx.token, payment_id);
      return ok(`Payment ${payment_id} cancelled.`);
    }),
  );
}
