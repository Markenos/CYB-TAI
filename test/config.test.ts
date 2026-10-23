import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { AKAHU_APP_TOKEN: "app", AKAHU_USER_TOKEN: "user" };

describe("loadConfig", () => {
  it("requires both tokens", () => {
    expect(() => loadConfig({ AKAHU_APP_TOKEN: "app" })).toThrow(/AKAHU_USER_TOKEN/);
  });
  it("defaults to payments off with a $500 cap", () => {
    const c = loadConfig(base);
    expect(c.enablePayments).toBe(false);
    expect(c.maxPaymentNzd).toBe(500);
    expect(c.allowedPayees).toBeNull();
  });
  it("parses payment settings", () => {
    const c = loadConfig({
      ...base,
      AKAHU_ENABLE_PAYMENTS: "true",
      AKAHU_MAX_PAYMENT_NZD: "250",
      AKAHU_ALLOWED_PAYEES: "123456789012300, 01-0123-0456789-000",
    });
    expect(c.enablePayments).toBe(true);
    expect(c.maxPaymentNzd).toBe(250);
    expect([...c.allowedPayees!]).toEqual(["12-3456-7890123-00", "01-0123-0456789-000"]);
  });
  it("rejects bad allow-list entries", () => {
    expect(() => loadConfig({ ...base, AKAHU_ALLOWED_PAYEES: "nope" })).toThrow(/invalid NZ account/);
  });
});
