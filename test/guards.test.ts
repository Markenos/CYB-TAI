import { describe, expect, it } from "vitest";
import { CONFIRMATION_TTL_MS, ConfirmationStore, validateAmount } from "../src/guards.js";

describe("ConfirmationStore", () => {
  const movement = { kind: "transfer" as const, params: { from: "a", to: "b", amount: 1 }, summary: "s" };

  it("is single-use", () => {
    const store = new ConfirmationStore();
    const { id } = store.add(movement);
    expect(store.take(id)?.params).toEqual(movement.params);
    expect(store.take(id)).toBeNull();
  });

  it("expires", () => {
    let now = 0;
    const store = new ConfirmationStore(() => now);
    const { id } = store.add(movement);
    now = CONFIRMATION_TTL_MS + 1;
    expect(store.take(id)).toBeNull();
  });
});

describe("validateAmount", () => {
  it("enforces positive, 2dp, and cap", () => {
    expect(validateAmount(10.5, 500)).toBeNull();
    expect(validateAmount(0.1 + 0.2, 500)).toBeNull(); // float noise is fine
    expect(validateAmount(19.99, 500)).toBeNull();
    expect(validateAmount(-1, 500)).toMatch(/positive/);
    expect(validateAmount(10.123, 500)).toMatch(/decimal/);
    expect(validateAmount(501, 500)).toMatch(/limit/);
  });
});
