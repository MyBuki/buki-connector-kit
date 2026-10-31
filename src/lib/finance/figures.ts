/**
 * The Finance figures, computed once here and read by both the Finance module
 * and the brief.
 *
 * Pure: canonical records and a date in, figures out. Money is kept per
 * currency and never converted. A figure whose inputs are not on file is
 * reported as missing, not as 0: a store with no bank transactions says
 * nothing about cash, and the page says so.
 */

import type { BankTransaction, Invoice, LedgerAccount, Party } from "../../data/canonical/types";

/** Sum per currency. */
export type Money = Map<string, number>;

function add(money: Money, currency: string, amount: number): void {
  money.set(currency, (money.get(currency) ?? 0) + amount);
}

export const isLive = (inv: Invoice): boolean => inv.status !== "void" && inv.status !== "draft";

export const isOpen = (inv: Invoice): boolean => inv.status === "unpaid" || inv.status === "part_paid";

export interface CashByAccount {
  bankAccountId: string;
  name: string; // the ledger account's name, or the id when it is not on file
  balance: Money;
  transactions: number;
}

/**
 * Cash per bank account as the sum of its transactions. This is a running
 * total from what was pulled, not a statement balance: it is only as complete
 * as the earliest transaction on file, and the label on the page says so.
 */
export function cashByBankAccount(txns: BankTransaction[], accounts: LedgerAccount[]): CashByAccount[] {
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  const out = new Map<string, CashByAccount>();
  for (const t of txns) {
    const row = out.get(t.bankAccountId) ?? { bankAccountId: t.bankAccountId, name: names.get(t.bankAccountId) ?? t.bankAccountId, balance: new Map(), transactions: 0 };
    add(row.balance, t.currency, t.amount);
    row.transactions += 1;
    out.set(t.bankAccountId, row);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface InvoicedInMonth {
  total: Money;
  count: number;
}

/** Sales invoiced in a month ("YYYY-MM"), by invoice date, void and draft left out. */
export function salesInvoicedIn(invoices: Invoice[], ym: string): InvoicedInMonth {
  const total: Money = new Map();
  let count = 0;
  for (const inv of invoices) {
    if (inv.kind !== "sales" || !isLive(inv) || !inv.date.startsWith(ym)) continue;
    add(total, inv.currency, inv.total);
    count += 1;
  }
  return { total, count };
}

export interface Overdue {
  invoices: Invoice[];
  total: Money; // outstanding, per currency
  /** Open sales invoices with no due date on file. They cannot be called overdue, and are not called current either. */
  noDueDate: number;
}

/** Open sales invoices whose due date is before today. */
export function overdueReceivables(invoices: Invoice[], today: string): Overdue {
  const open = invoices.filter((inv) => inv.kind === "sales" && isOpen(inv));
  const noDueDate = open.filter((inv) => !inv.dueDate).length;
  const late = open.filter((inv) => inv.dueDate && inv.dueDate < today).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const total: Money = new Map();
  for (const inv of late) add(total, inv.currency, inv.outstanding);
  return { invoices: late, total, noDueDate };
}

export interface SpendByAccount {
  accountId: string;
  name: string; // the ledger account's name, or "account not on file"
  total: Money;
  lines: number;
}

/** Purchase invoice lines in a month, grouped by the ledger account they were posted to. */
export function spendByAccountIn(invoices: Invoice[], accounts: LedgerAccount[], ym: string): SpendByAccount[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, SpendByAccount>();
  for (const inv of invoices) {
    if (inv.kind !== "purchase" || !isLive(inv) || !inv.date.startsWith(ym)) continue;
    for (const line of inv.lines) {
      const account = byId.get(line.accountId);
      const row = out.get(line.accountId) ?? { accountId: line.accountId, name: account?.name ?? "account not on file", total: new Map(), lines: 0 };
      add(row.total, inv.currency, line.net);
      row.lines += 1;
      out.set(line.accountId, row);
    }
  }
  return [...out.values()].sort((a, b) => sumAll(b.total) - sumAll(a.total));
}

/** Spend in a month on the accounts whose name contains the words given. */
export function spendOnAccountIn(invoices: Invoice[], accounts: LedgerAccount[], ym: string, accountName: string): SpendByAccount[] {
  const wanted = accountName.trim().toLowerCase();
  return spendByAccountIn(invoices, accounts, ym).filter((row) => row.name.toLowerCase().includes(wanted));
}

export interface CustomerFigure {
  partyId: string;
  name: string; // the party's name, or "customer not on file"
  outstanding: Money;
  invoiced: Money; // every live sales invoice on file
  invoices: number;
}

function customerFigures(invoices: Invoice[], parties: Party[]): CustomerFigure[] {
  const names = new Map(parties.map((p) => [p.id, p.name]));
  const out = new Map<string, CustomerFigure>();
  for (const inv of invoices) {
    if (inv.kind !== "sales" || !isLive(inv)) continue;
    const row = out.get(inv.partyId) ?? { partyId: inv.partyId, name: names.get(inv.partyId) ?? "customer not on file", outstanding: new Map(), invoiced: new Map(), invoices: 0 };
    add(row.invoiced, inv.currency, inv.total);
    if (isOpen(inv)) add(row.outstanding, inv.currency, inv.outstanding);
    row.invoices += 1;
    out.set(inv.partyId, row);
  }
  return [...out.values()];
}

/** Top customers by what they still owe. */
export function topCustomersByOutstanding(invoices: Invoice[], parties: Party[], n = 5): CustomerFigure[] {
  return customerFigures(invoices, parties)
    .filter((c) => sumAll(c.outstanding) > 0)
    .sort((a, b) => sumAll(b.outstanding) - sumAll(a.outstanding))
    .slice(0, n);
}

/** Top customers by everything invoiced to them on file. */
export function biggestCustomers(invoices: Invoice[], parties: Party[], n = 5): CustomerFigure[] {
  return customerFigures(invoices, parties)
    .sort((a, b) => sumAll(b.invoiced) - sumAll(a.invoiced))
    .slice(0, n);
}

/**
 * Every currency added together, for ORDERING only. Never shown: a ranking
 * needs one number, a figure on a page does not get one across currencies.
 */
export function sumAll(money: Money): number {
  let s = 0;
  for (const v of money.values()) s += v;
  return s;
}
