import { AkahuClient } from "akahu";
import type { Account, PendingTransaction, Transaction } from "akahu";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";

/** The subset of the Akahu SDK this server uses, so tests can supply a fake. */
export type AkahuApi = {
  users: Pick<AkahuClient["users"], "get">;
  accounts: Pick<
    AkahuClient["accounts"],
    "list" | "get" | "listTransactions" | "listPendingTransactions" | "refresh" | "refreshAll"
  >;
  transactions: Pick<AkahuClient["transactions"], "list" | "listPending">;
  payments: Pick<AkahuClient["payments"], "list" | "get" | "create" | "cancel">;
  transfers: Pick<AkahuClient["transfers"], "list" | "get" | "create">;
};

export type Context = {
  akahu: AkahuApi;
  token: string;
  config: Config;
};

export function createAkahuClient(config: Config): AkahuApi {
  return new AkahuClient({ appToken: config.appToken });
}

/** A tool result with both a readable summary and structured data. */
export function ok(text: string, data?: unknown): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text }];
  if (data !== undefined) content.push({ type: "text", text: JSON.stringify(data, null, 2) });
  return { content };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Turns Akahu SDK/HTTP errors into messages the model can relay to the user. */
export function describeError(err: unknown): string {
  const e = err as { isAkahuError?: boolean; status?: number; message?: string };
  if (e?.isAkahuError && typeof e.status === "number") {
    switch (e.status) {
      case 401:
        return "Akahu rejected the credentials (401). Check AKAHU_APP_TOKEN and AKAHU_USER_TOKEN, or regenerate the user token at my.akahu.nz.";
      case 403:
        return `Akahu refused this action (403): ${e.message}. If this was a payment or transfer, enable those permissions for your Personal App at my.akahu.nz.`;
      case 404:
        return `Not found (404): ${e.message}. Check the ID - use list_accounts to see valid account IDs.`;
      case 429:
        return "Akahu rate limit hit (429). Wait a minute and try again.";
      default:
        return `Akahu API error (${e.status}): ${e.message}`;
    }
  }
  return `Error: ${e?.message ?? String(err)}`;
}

/** Wraps a handler so thrown errors become `isError` results. */
export function safe<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(describeError(err));
    }
  };
}

export function shapeAccount(a: Account) {
  return {
    id: a._id,
    name: a.name,
    institution: a.connection?.name,
    type: a.type,
    status: a.status,
    account_number: a.formatted_account,
    holder: a.meta?.holder,
    balance: a.balance
      ? {
          currency: a.balance.currency,
          current: a.balance.current,
          available: a.balance.available,
          limit: a.balance.limit,
          overdrawn: a.balance.overdrawn,
        }
      : undefined,
    attributes: a.attributes,
    loan_details: a.meta?.loan_details,
    refreshed: a.refreshed,
  };
}

export function shapeTransaction(t: Transaction | PendingTransaction) {
  const enriched = t as Partial<{
    _id: string;
    merchant: { name: string };
    category: { name: string; groups?: Record<string, { name: string }> };
    meta: { particulars?: string; code?: string; reference?: string; other_account?: string; card_suffix?: string };
    balance: number;
  }>;
  return {
    id: enriched._id,
    account_id: t._account,
    date: t.date,
    description: t.description,
    amount: t.amount,
    type: t.type,
    balance: enriched.balance,
    merchant: enriched.merchant?.name,
    category: enriched.category?.name,
    category_group: enriched.category?.groups?.personal_finance?.name,
    particulars: enriched.meta?.particulars,
    code: enriched.meta?.code,
    reference: enriched.meta?.reference,
    other_account: enriched.meta?.other_account,
    card_suffix: enriched.meta?.card_suffix,
  };
}

export type ShapedTransaction = ReturnType<typeof shapeTransaction>;
