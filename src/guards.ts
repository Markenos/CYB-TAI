import { randomUUID } from "node:crypto";
import type { PaymentCreateParams, TransferCreateParams } from "akahu";

export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type PendingMovement =
  | { kind: "payment"; params: PaymentCreateParams; summary: string; expiresAt: number }
  | { kind: "transfer"; params: TransferCreateParams; summary: string; expiresAt: number };

type NewMovement =
  | { kind: "payment"; params: PaymentCreateParams; summary: string }
  | { kind: "transfer"; params: TransferCreateParams; summary: string };

/**
 * Holds prepared payments/transfers until the user confirms them. Each
 * confirmation ID is single-use and expires, and the stored request is what
 * gets sent - the model can't change the details between approval and sending.
 */
export class ConfirmationStore {
  private pending = new Map<string, PendingMovement>();

  constructor(private now: () => number = Date.now) {}

  add(movement: NewMovement): { id: string; expiresAt: number } {
    this.sweep();
    const id = randomUUID();
    const expiresAt = this.now() + CONFIRMATION_TTL_MS;
    this.pending.set(id, { ...movement, expiresAt } as PendingMovement);
    return { id, expiresAt };
  }

  /** Removes and returns the movement, or null if unknown/expired. */
  take(id: string): PendingMovement | null {
    this.sweep();
    const m = this.pending.get(id);
    if (!m) return null;
    this.pending.delete(id);
    return m;
  }

  private sweep() {
    const t = this.now();
    for (const [id, m] of this.pending) if (m.expiresAt <= t) this.pending.delete(id);
  }
}

/** Akahu's particulars/code/reference fields are 12 characters max. */
export const MAX_REF_LENGTH = 12;

export function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function validateAmount(amount: number, maxNzd: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Amount must be a positive number.";
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
    return "Amount can't have more than 2 decimal places.";
  if (amount > maxNzd)
    return `Amount exceeds the configured limit of $${maxNzd} NZD (AKAHU_MAX_PAYMENT_NZD). The user can raise it in their MCP config.`;
  return null;
}
