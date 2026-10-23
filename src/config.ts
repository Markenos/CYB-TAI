import { z } from "zod";
import { normaliseAccountNumber } from "./format.js";

const boolish = z
  .string()
  .optional()
  .transform((v) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase()));

const EnvSchema = z.object({
  AKAHU_APP_TOKEN: z.string({ error: "is required" }).trim().min(1, "is required"),
  AKAHU_USER_TOKEN: z.string({ error: "is required" }).trim().min(1, "is required"),
  AKAHU_ENABLE_PAYMENTS: boolish,
  AKAHU_MAX_PAYMENT_NZD: z.coerce.number().positive().default(500),
  AKAHU_ALLOWED_PAYEES: z.string().optional(),
});

export type Config = {
  appToken: string;
  userToken: string;
  enablePayments: boolean;
  maxPaymentNzd: number;
  /** Normalised NZ account numbers, or null when no allow-list is set. */
  allowedPayees: Set<string> | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid Akahu MCP configuration:\n${issues}`);
  }
  const e = parsed.data;

  let allowedPayees: Set<string> | null = null;
  if (e.AKAHU_ALLOWED_PAYEES?.trim()) {
    allowedPayees = new Set();
    for (const raw of e.AKAHU_ALLOWED_PAYEES.split(",").map((s) => s.trim()).filter(Boolean)) {
      const n = normaliseAccountNumber(raw);
      if (!n) throw new Error(`AKAHU_ALLOWED_PAYEES contains an invalid NZ account number: ${raw}`);
      allowedPayees.add(n);
    }
  }

  return {
    appToken: e.AKAHU_APP_TOKEN,
    userToken: e.AKAHU_USER_TOKEN,
    enablePayments: e.AKAHU_ENABLE_PAYMENTS,
    maxPaymentNzd: e.AKAHU_MAX_PAYMENT_NZD,
    allowedPayees,
  };
}
