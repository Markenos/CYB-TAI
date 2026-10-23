import { beforeEach, describe, expect, it } from "vitest";
import { account, connect, fakeAkahu, testConfig, tx } from "./helpers.js";

let akahu: ReturnType<typeof fakeAkahu>;
beforeEach(() => {
  akahu = fakeAkahu();
});

describe("tool registration", () => {
  it("hides money-movement tools unless payments are enabled", async () => {
    const off = await connect(akahu);
    const offNames = (await off.client.listTools()).tools.map((t) => t.name);
    expect(offNames).toContain("list_accounts");
    expect(offNames).not.toContain("confirm_money_movement");

    const on = await connect(akahu, testConfig({ enablePayments: true }));
    const onNames = (await on.client.listTools()).tools.map((t) => t.name);
    expect(onNames).toEqual(expect.arrayContaining(["prepare_payment", "prepare_transfer", "confirm_money_movement"]));
  });
});

describe("read tools", () => {
  it("lists active accounts with balances", async () => {
    akahu.accounts.list.mockResolvedValue([account(), account({ _id: "acc_old", name: "Old", status: "INACTIVE" })]);
    const { call } = await connect(akahu);
    const res = await call("list_accounts");
    expect(akahu.accounts.list).toHaveBeenCalledWith("user_token_test");
    expect(res.text).toContain("Everyday [ASB, CHECKING] $1,000.00 (available $900.00)");
    expect(res.text).not.toContain("acc_old");
  });

  it("follows pagination cursors up to the limit", async () => {
    akahu.transactions.list
      .mockResolvedValueOnce({ items: [tx({ _id: "t1" }), tx({ _id: "t2" })], cursor: { next: "c2" } })
      .mockResolvedValueOnce({ items: [tx({ _id: "t3" })], cursor: { next: null } });
    const { call } = await connect(akahu);
    const res = await call("list_transactions", { start: "2026-10-01", end: "2026-10-31" });
    expect(akahu.transactions.list).toHaveBeenCalledTimes(2);
    expect(akahu.transactions.list.mock.calls[0][1]).toMatchObject({
      start: "2026-09-30T11:00:00.000Z",
      end: "2026-10-31T11:00:00.000Z",
    });
    expect(akahu.transactions.list.mock.calls[1][1].cursor).toBe("c2");
    expect(res.text).toContain("3 transaction(s)");
  });

  it("summarises spending by category, ignoring transfers", async () => {
    akahu.transactions.list.mockResolvedValue({
      items: [
        tx({ amount: -50 }),
        tx({ amount: -30.25 }),
        tx({ amount: -100, type: "TRANSFER", category: undefined, merchant: undefined }),
        tx({ amount: 2000, type: "DIRECT CREDIT", category: { _id: "c", name: "Salary", groups: {} } }),
      ],
      cursor: { next: null },
    });
    const { call } = await connect(akahu);
    const res = await call("spending_summary", { group_by: "category" });
    expect(res.text).toContain("Spent $80.25, received $2,000.00, net $1,919.75");
    expect(res.text).toContain("Supermarkets: spent $80.25");
  });

  it("searches by merchant text and direction", async () => {
    akahu.transactions.list.mockResolvedValue({
      items: [tx({ _id: "a" }), tx({ _id: "b", description: "Z ENERGY", merchant: { _id: "z", name: "Z" } })],
      cursor: { next: null },
    });
    const { call } = await connect(akahu);
    const res = await call("search_transactions", { query: "countdown", direction: "out" });
    expect(res.text).toContain("1 match(es)");
  });

  it("turns Akahu auth errors into friendly messages", async () => {
    akahu.accounts.list.mockRejectedValue(Object.assign(new Error("Unauthorized"), { isAkahuError: true, status: 401 }));
    const { call } = await connect(akahu);
    const res = await call("list_accounts");
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/AKAHU_USER_TOKEN/);
  });
});

describe("money movement", () => {
  const payArgs = {
    from_account_id: "acc_everyday",
    amount: 120,
    payee_name: "Flatmate",
    payee_account_number: "01 0123 0456789 00",
    their_reference: "power",
  };

  async function setup(config = testConfig({ enablePayments: true })) {
    akahu.accounts.get.mockResolvedValue(account());
    akahu.payments.create.mockResolvedValue({ _id: "payment_1", status: "READY" });
    return connect(akahu, config);
  }

  function confirmationId(text: string) {
    return text.match(/"confirmation_id": "([^"]+)"/)![1];
  }

  it("prepares without sending, then sends exactly what was prepared once", async () => {
    const { call } = await setup();
    const prep = await call("prepare_payment", payArgs);
    expect(prep.isError).toBeFalsy();
    expect(prep.text).toContain("PAY $120.00 to Flatmate (01-0123-0456789-00)");
    expect(akahu.payments.create).not.toHaveBeenCalled();

    const id = confirmationId(prep.text);
    const sent = await call("confirm_money_movement", { confirmation_id: id });
    expect(sent.text).toContain("Payment submitted");
    expect(akahu.payments.create).toHaveBeenCalledWith(
      "user_token_test",
      expect.objectContaining({
        from: "acc_everyday",
        amount: 120,
        to: { name: "Flatmate", account_number: "01-0123-0456789-00" },
      }),
      { idempotencyKey: id },
    );

    const again = await call("confirm_money_movement", { confirmation_id: id });
    expect(again.isError).toBe(true);
    expect(akahu.payments.create).toHaveBeenCalledTimes(1);
  });

  it("blocks payments over the cap", async () => {
    const { call } = await setup();
    const res = await call("prepare_payment", { ...payArgs, amount: 501 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/limit of \$500/);
  });

  it("blocks payees not on the allow-list", async () => {
    const { call } = await setup(testConfig({ enablePayments: true, allowedPayees: new Set(["12-3456-7890123-00"]) }));
    const res = await call("prepare_payment", payArgs);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/allow-list/);
  });

  it("blocks payments larger than the available balance", async () => {
    const { call } = await setup(testConfig({ enablePayments: true, maxPaymentNzd: 5000 }));
    const res = await call("prepare_payment", { ...payArgs, amount: 950 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Insufficient funds/);
  });

  it("rejects invalid account numbers", async () => {
    const { call } = await setup();
    const res = await call("prepare_payment", { ...payArgs, payee_account_number: "12-34" });
    expect(res.isError).toBe(true);
  });

  it("prepares and confirms transfers between own accounts", async () => {
    akahu.accounts.get.mockImplementation(async (_t: string, id: string) =>
      account({ _id: id, name: id === "acc_savings" ? "Savings" : "Everyday" }),
    );
    akahu.transfers.create.mockResolvedValue({ _id: "transfer_1", status: "SENT" });
    const { call } = await connect(akahu, testConfig({ enablePayments: true }));
    const prep = await call("prepare_transfer", {
      from_account_id: "acc_everyday",
      to_account_id: "acc_savings",
      amount: 50,
    });
    expect(prep.text).toContain("TRANSFER $50.00 from Everyday (ASB) to Savings (ASB)");
    const sent = await call("confirm_money_movement", { confirmation_id: confirmationId(prep.text) });
    expect(sent.text).toContain("Transfer submitted");
    expect(akahu.transfers.create).toHaveBeenCalledWith(
      "user_token_test",
      { from: "acc_everyday", to: "acc_savings", amount: 50 },
      expect.any(Object),
    );
  });
});
