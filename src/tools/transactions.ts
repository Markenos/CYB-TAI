import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Paginated, Transaction } from "akahu";
import { z } from "zod";
import { ok, safe, shapeTransaction, type Context, type ShapedTransaction } from "../akahu.js";
import { formatNzd, nzDaysAgo, nzMonth, nzToday, toAkahuTimestamp } from "../format.js";

const MAX_LIMIT = 1000;

const rangeShape = {
  start: z
    .string()
    .optional()
    .describe("Start date (YYYY-MM-DD, NZ time) or ISO timestamp. Defaults to 30 days ago."),
  end: z.string().optional().describe("End date, inclusive (YYYY-MM-DD, NZ time) or ISO timestamp. Defaults to today."),
  account_id: z.string().optional().describe("Only this account. Omit for all accounts."),
};

export type FetchOptions = {
  start?: string;
  end?: string;
  account_id?: string;
  cursor?: string;
  limit?: number;
};

/** Fetches settled transactions, following Akahu's cursor until `limit` is reached. */
export async function fetchTransactions(ctx: Context, opts: FetchOptions) {
  const limit = Math.min(opts.limit ?? 100, MAX_LIMIT);
  const query = {
    start: toAkahuTimestamp(opts.start ?? nzDaysAgo(30)),
    end: toAkahuTimestamp(opts.end ?? nzToday(), true),
  };
  const items: ShapedTransaction[] = [];
  let cursor: string | null | undefined = opts.cursor;
  do {
    const page: Paginated<Transaction> = opts.account_id
      ? await ctx.akahu.accounts.listTransactions(ctx.token, opts.account_id, { ...query, cursor })
      : await ctx.akahu.transactions.list(ctx.token, { ...query, cursor });
    items.push(...page.items.map(shapeTransaction));
    cursor = page.cursor?.next;
  } while (cursor && items.length < limit);

  // Anything beyond `limit` is dropped; hand back a cursor only if we stopped on a page boundary.
  const truncated = items.length > limit;
  return {
    range: query,
    transactions: items.slice(0, limit),
    next_cursor: truncated ? null : (cursor ?? null),
    truncated,
  };
}

export type TransactionFilter = {
  query?: string;
  category?: string;
  min_amount?: number;
  max_amount?: number;
  direction?: "in" | "out";
  type?: string;
};

export function filterTransactions(txs: ShapedTransaction[], f: TransactionFilter): ShapedTransaction[] {
  const q = f.query?.toLowerCase();
  const cat = f.category?.toLowerCase();
  return txs.filter((t) => {
    if (q && ![t.description, t.merchant, t.particulars, t.code, t.reference].some((s) => s?.toLowerCase().includes(q)))
      return false;
    if (cat && ![t.category, t.category_group].some((s) => s?.toLowerCase().includes(cat))) return false;
    const abs = Math.abs(t.amount);
    if (f.min_amount !== undefined && abs < f.min_amount) return false;
    if (f.max_amount !== undefined && abs > f.max_amount) return false;
    if (f.direction === "in" && t.amount <= 0) return false;
    if (f.direction === "out" && t.amount >= 0) return false;
    if (f.type && t.type !== f.type.toUpperCase()) return false;
    return true;
  });
}

export type GroupBy = "category" | "category_group" | "merchant" | "month" | "account";

export function summarise(txs: ShapedTransaction[], groupBy: GroupBy, excludeTransfers: boolean) {
  const rows = new Map<string, { group: string; spent: number; received: number; count: number }>();
  let spent = 0;
  let received = 0;
  for (const t of txs) {
    if (excludeTransfers && t.type === "TRANSFER") continue;
    const key =
      (groupBy === "month" ? nzMonth(t.date) : groupBy === "account" ? t.account_id : t[groupBy]) ?? "Uncategorised";
    const row = rows.get(key) ?? { group: key, spent: 0, received: 0, count: 0 };
    if (t.amount < 0) {
      row.spent += -t.amount;
      spent += -t.amount;
    } else {
      row.received += t.amount;
      received += t.amount;
    }
    row.count++;
    rows.set(key, row);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const groups = [...rows.values()]
    .map((r) => ({ ...r, spent: round(r.spent), received: round(r.received), net: round(r.received - r.spent) }))
    .sort((a, b) => (groupBy === "month" ? a.group.localeCompare(b.group) : b.spent - a.spent));
  return { total_spent: round(spent), total_received: round(received), net: round(received - spent), groups };
}

function txLine(t: ShapedTransaction) {
  const who = t.merchant ?? t.description;
  const cat = t.category ? ` [${t.category}]` : "";
  return `${t.date.slice(0, 10)}  ${formatNzd(t.amount).padStart(12)}  ${who}${cat}`;
}

export function registerTransactionTools(server: McpServer, ctx: Context) {
  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description:
        "Settled transactions across all connected accounts (or one account) for a date range, newest first, with merchant and category where Akahu has enriched them. Negative amounts are money out.",
      inputSchema: {
        ...rangeShape,
        limit: z.number().int().min(1).max(MAX_LIMIT).default(100).describe("Max transactions to return"),
        cursor: z.string().optional().describe("next_cursor from a previous call, to continue paging"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async (args) => {
      const res = await fetchTransactions(ctx, args);
      const more = res.next_cursor ? `\nMore available - pass cursor "${res.next_cursor}".` : "";
      return ok(
        `${res.transactions.length} transaction(s):\n${res.transactions.map(txLine).join("\n")}${more}`,
        res,
      );
    }),
  );

  server.registerTool(
    "list_pending_transactions",
    {
      title: "List pending transactions",
      description:
        "Transactions the bank hasn't settled yet (e.g. recent card purchases). These have no stable ID and can change or disappear.",
      inputSchema: { account_id: z.string().optional().describe("Only this account") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ account_id }) => {
      const raw = account_id
        ? await ctx.akahu.accounts.listPendingTransactions(ctx.token, account_id)
        : await ctx.akahu.transactions.listPending(ctx.token);
      const txs = raw.map(shapeTransaction);
      return ok(`${txs.length} pending transaction(s):\n${txs.map(txLine).join("\n")}`, txs);
    }),
  );

  server.registerTool(
    "search_transactions",
    {
      title: "Search transactions",
      description:
        "Finds transactions matching text (description, merchant, particulars/code/reference), category, amount range, direction or type within a date range.",
      inputSchema: {
        ...rangeShape,
        query: z.string().optional().describe("Text to look for, e.g. 'countdown' or 'rent'"),
        category: z.string().optional().describe("Category or category group name, e.g. 'Groceries'"),
        min_amount: z.number().nonnegative().optional().describe("Minimum absolute amount in NZD"),
        max_amount: z.number().nonnegative().optional().describe("Maximum absolute amount in NZD"),
        direction: z.enum(["in", "out"]).optional(),
        type: z.string().optional().describe("Akahu transaction type, e.g. EFTPOS, DIRECT DEBIT, PAYMENT"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ start, end, account_id, ...filter }) => {
      const res = await fetchTransactions(ctx, { start, end, account_id, limit: MAX_LIMIT });
      const hits = filterTransactions(res.transactions, filter);
      const note = res.truncated || res.next_cursor ? "\n(Searched the first 1000 transactions; narrow the dates for more.)" : "";
      return ok(`${hits.length} match(es):\n${hits.map(txLine).join("\n")}${note}`, {
        range: res.range,
        matches: hits,
      });
    }),
  );

  server.registerTool(
    "spending_summary",
    {
      title: "Spending summary",
      description:
        "Totals money in and out for a date range, grouped by category, category group, merchant, month or account. Good for budgeting questions like 'where did my money go last month?'.",
      inputSchema: {
        ...rangeShape,
        group_by: z.enum(["category", "category_group", "merchant", "month", "account"]).default("category"),
        exclude_transfers: z
          .boolean()
          .default(true)
          .describe("Ignore transfers between the user's own accounts so they don't count as spending"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async ({ start, end, account_id, group_by, exclude_transfers }) => {
      const res = await fetchTransactions(ctx, { start, end, account_id, limit: MAX_LIMIT });
      const s = summarise(res.transactions, group_by, exclude_transfers);
      const lines = s.groups.map(
        (g) => `- ${g.group}: spent ${formatNzd(g.spent)}, received ${formatNzd(g.received)} (${g.count} txns)`,
      );
      const note = res.truncated || res.next_cursor ? "\n(Based on the first 1000 transactions in range.)" : "";
      return ok(
        `Spent ${formatNzd(s.total_spent)}, received ${formatNzd(s.total_received)}, net ${formatNzd(s.net)}\n${lines.join("\n")}${note}`,
        { range: res.range, ...s },
      );
    }),
  );
}
