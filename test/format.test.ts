import { describe, expect, it } from "vitest";
import { formatNzd, normaliseAccountNumber, nzToday, toAkahuTimestamp } from "../src/format.js";

describe("normaliseAccountNumber", () => {
  it("accepts common formats", () => {
    expect(normaliseAccountNumber("12-3456-7890123-00")).toBe("12-3456-7890123-00");
    expect(normaliseAccountNumber("12 3456 7890123 001")).toBe("12-3456-7890123-001");
    expect(normaliseAccountNumber("123456789012300")).toBe("12-3456-7890123-00");
  });
  it("rejects junk", () => {
    expect(normaliseAccountNumber("12-3456-789")).toBeNull();
    expect(normaliseAccountNumber("ab-cdef-ghijklm-no")).toBeNull();
  });
});

describe("toAkahuTimestamp", () => {
  it("treats bare dates as NZ midnight (NZDT, UTC+13)", () => {
    expect(toAkahuTimestamp("2026-01-15")).toBe("2026-01-14T11:00:00.000Z");
  });
  it("treats bare dates as NZ midnight (NZST, UTC+12)", () => {
    expect(toAkahuTimestamp("2026-07-15")).toBe("2026-07-14T12:00:00.000Z");
  });
  it("makes end dates inclusive", () => {
    expect(toAkahuTimestamp("2026-07-15", true)).toBe("2026-07-15T12:00:00.000Z");
  });
  it("passes timestamps through", () => {
    expect(toAkahuTimestamp("2026-07-15T03:00:00Z")).toBe("2026-07-15T03:00:00.000Z");
  });
  it("rejects garbage", () => {
    expect(() => toAkahuTimestamp("last tuesday")).toThrow();
  });
});

it("formats NZD and NZ dates", () => {
  expect(formatNzd(-1234.5)).toBe("-$1,234.50");
  expect(nzToday(new Date("2026-10-23T12:00:00Z"))).toBe("2026-10-24");
});
