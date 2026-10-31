/**
 * The canonical shapes. Every source normalizes INTO these, and everything
 * downstream (the store, the brief, the modules) reads ONLY these. A new source
 * adds a connector; it never adds a field here that one source has and another
 * cannot supply without making that field optional.
 *
 * Two domains: HR (people) and finance (the books). Each has its own source
 * setting and its own provider, and a sync of one never depends on the other.
 */

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

export type HrSource = "bamboohr";

export const HR_SOURCES: readonly HrSource[] = ["bamboohr"];

export interface Employee {
  id: string; // `${source}:${sourceId}`
  source: HrSource;
  sourceId: string;
  displayName: string;
  title: string;
  department: string;
  location: string;
  managerId: string | null; // canonical id of the manager, null for the top
  hireDate: string; // YYYY-MM-DD
  terminationDate: string | null;
  status: "active" | "terminated";
  // Optional: a source that cannot supply one of these leaves it ABSENT. Never
  // default it. A defaulted salary of 0 turns a team cost into a wrong number
  // that reads as fact; an absent one lets the brief say "not on file".
  annualSalary?: number; // base only, in `currency`
  currency?: string; // ISO 4217
  employmentType?: "full-time" | "part-time" | "contractor";
  workEmail?: string;
  sourceUpdatedAt?: string; // ISO timestamp from the source
}

/**
 * Kept as a named alias so the rule reads at the call sites: a provider returns
 * employees that MAY be missing the optional fields, and nothing after the
 * provider fills them in.
 */
export type PartialEmployee = Employee;

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export type FinanceSource = "sage";

export const FINANCE_SOURCES: readonly FinanceSource[] = ["sage"];

/** The same rule as HR: a field the source cannot supply is left absent, never defaulted. */

export interface LedgerAccount {
  id: string; // `${source}:${sourceId}`
  source: FinanceSource;
  sourceId: string;
  code?: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  sourceUpdatedAt?: string;
}

export interface Party {
  id: string;
  source: FinanceSource;
  sourceId: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  email?: string;
  sourceUpdatedAt?: string;
}

export interface InvoiceLine {
  description: string;
  accountId: string; // canonical LedgerAccount id
  net: number;
}

export interface Invoice {
  id: string;
  source: FinanceSource;
  sourceId: string;
  kind: "sales" | "purchase";
  partyId: string; // canonical Party id
  number?: string;
  date: string; // YYYY-MM-DD
  dueDate?: string;
  status: "draft" | "unpaid" | "part_paid" | "paid" | "void";
  currency: string; // ISO 4217
  total: number;
  outstanding: number;
  lines: InvoiceLine[];
  sourceUpdatedAt?: string;
}

export interface BankTransaction {
  id: string;
  source: FinanceSource;
  sourceId: string;
  bankAccountId: string; // canonical LedgerAccount id of the bank account
  date: string; // YYYY-MM-DD
  amount: number; // signed: money in is positive, money out is negative
  currency: string;
  description: string;
  accountId?: string; // the ledger account it was posted against, when known
  partyId?: string;
  sourceUpdatedAt?: string;
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export type Domain = "hr" | "finance";

export type AnySource = HrSource | FinanceSource;

export const SOURCE_LABEL: Record<AnySource, string> = {
  bamboohr: "BambooHR",
  sage: "Sage",
};

/** One domain's sync, succeeded or failed. The store keeps the recent ones. */
export interface SyncRun {
  at: string;
  domain: Domain;
  source: AnySource;
  ok: boolean;
  pulled: number;
  added: number;
  changed: number;
  removed: number;
  durationMs: number;
  error?: string;
}
