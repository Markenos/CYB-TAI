import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Account, Transaction } from "akahu";
import { vi } from "vitest";
import type { AkahuApi } from "../src/akahu.js";
import type { Config } from "../src/config.js";
import { buildServer } from "../src/server.js";

export function account(overrides: Partial<Account> = {}): Account {
  return {
    _id: "acc_everyday",
    _authorisation: "auth_1",
    _credentials: "cred_1",
    connection: { _id: "conn_1", name: "ASB", logo: "", connection_type: "official" },
    name: "Everyday",
    status: "ACTIVE",
    formatted_account: "12-3456-7890123-00",
    type: "CHECKING",
    attributes: ["TRANSACTIONS", "PAYMENT_FROM", "TRANSFER_FROM", "TRANSFER_TO"],
    balance: { currency: "NZD", current: 1000, available: 900 },
    ...overrides,
  };
}

export function tx(overrides: Partial<Record<string, unknown>> = {}): Transaction {
  return {
    _id: "trans_1",
    _user: "user_1",
    _account: "acc_everyday",
    _connection: "conn_1",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    date: "2026-10-01T00:00:00Z",
    hash: "h",
    description: "COUNTDOWN PONSONBY",
    amount: -50,
    type: "EFTPOS",
    merchant: { _id: "m1", name: "Countdown" },
    category: { _id: "c1", name: "Supermarkets", groups: { personal_finance: { _id: "g1", name: "Food" } } },
    meta: {},
    ...overrides,
  } as Transaction;
}

export function fakeAkahu(): { [K in keyof AkahuApi]: { [M in keyof AkahuApi[K]]: ReturnType<typeof vi.fn> } } {
  return {
    users: { get: vi.fn() },
    accounts: {
      list: vi.fn(),
      get: vi.fn(),
      listTransactions: vi.fn(),
      listPendingTransactions: vi.fn(),
      refresh: vi.fn(),
      refreshAll: vi.fn(),
    },
    transactions: { list: vi.fn(), listPending: vi.fn() },
    payments: { list: vi.fn(), get: vi.fn(), create: vi.fn(), cancel: vi.fn() },
    transfers: { list: vi.fn(), get: vi.fn(), create: vi.fn() },
  };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    appToken: "app_token_test",
    userToken: "user_token_test",
    enablePayments: false,
    maxPaymentNzd: 500,
    allowedPayees: null,
    ...overrides,
  };
}

export async function connect(akahu: ReturnType<typeof fakeAkahu>, config = testConfig()) {
  const server = buildServer({ akahu: akahu as unknown as AkahuApi, token: config.userToken, config });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    return { ...res, text: res.content.map((c) => c.text).join("\n") };
  };
  return { client, call };
}
