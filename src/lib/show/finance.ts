/**
 * The Finance module as text: what the satellite's /finance page shows, each
 * section ending with its citation. Pure: the finance store and a date in, a
 * string out. Money stays per currency and is never converted; a negative
 * balance prints in parentheses.
 *
 * `npm run check` renders a file through this same function, so a candidate
 * sees the module their connector will fill before writing a line of OAuth.
 */

import { fmtDate, fmtMoney, monthLabel, plural } from "../format";
import { biggestCustomers, cashByBankAccount, overdueReceivables, salesInvoicedIn, spendByAccountIn, type Money } from "../finance/figures";
import { periodsOf } from "../people/figures";
import type { FinanceStore } from "../store/store";
import { NOTHING_SYNCED, NO_FINANCE_SOURCE } from "../brief/answer";
import { cite, table } from "./table";

const NOT_ON_FILE = "not on file";

/** "$12,000 and EUR 300", or "not on file" when there is nothing to show. */
const moneyText = (money: Money): string => (money.size ? [...money].map(([ccy, amount]) => fmtMoney(amount, ccy)).join(" and ") : NOT_ON_FILE);

export interface FinanceEnv {
  /** The source FINANCE_SOURCE names, null when unset. */
  configuredSource: string | null;
  /** The error reading FINANCE_SOURCE, when it names something unknown. */
  error: string | null;
}

export function renderFinance(finance: FinanceStore, now: Date, env: FinanceEnv = { configuredSource: finance.source, error: null }): string {
  if (!finance.source) {
    if (env.error) return `Finance\n\n${env.error}`;
    if (env.configuredSource) return `Finance\n\n${NOTHING_SYNCED}\nIn the kit, that is npm run sync.`;
    return `Finance\n\n${NO_FINANCE_SOURCE}`;
  }

  const { today, thisMonth, lastMonth } = periodsOf(now);
  const source = cite(finance.source, finance.syncedAt);
  const cash = cashByBankAccount(finance.bankTransactions, finance.accounts);
  const revThis = salesInvoicedIn(finance.invoices, thisMonth);
  const revLast = salesInvoicedIn(finance.invoices, lastMonth);
  const overdue = overdueReceivables(finance.invoices, today);
  const spend = spendByAccountIn(finance.invoices, finance.accounts, lastMonth);
  const customers = biggestCustomers(finance.invoices, finance.parties, 5);
  const haveInvoices = finance.invoices.length > 0;
  const out: string[] = [];

  out.push("Finance", source, "");

  out.push("Cash across bank accounts");
  out.push("From transactions, not a statement: each balance is the sum of the transactions on file for that account.");
  if (cash.length) {
    out.push(
      table(
        [{ header: "Bank account" }, { header: "Balance", num: true }, { header: "Transactions", num: true }],
        cash.map((row) => [row.name, moneyText(row.balance), String(row.transactions)]),
      ),
    );
  } else {
    out.push("  No bank transactions on file.");
  }
  out.push(source, "");

  const invoiced = (label: string, r: { total: Money; count: number }, none: string) =>
    `${label}: ${!haveInvoices ? NOT_ON_FILE : r.count ? `${moneyText(r.total)} (${plural(r.count, "sales invoice")}, void and draft left out)` : none}`;
  out.push(invoiced(`Invoiced in ${monthLabel(thisMonth)}`, revThis, "none dated this month"));
  out.push(invoiced(`Invoiced in ${monthLabel(lastMonth)}`, revLast, "none dated that month"));
  out.push(
    `Overdue receivables: ${
      !haveInvoices
        ? NOT_ON_FILE
        : `${overdue.invoices.length ? moneyText(overdue.total) : "none"} (${plural(overdue.invoices.length, "open sales invoice")} past due${
            overdue.noDueDate ? `; ${overdue.noDueDate} open with no due date on file, not counted` : ""
          })`
    }`,
  );
  out.push(source, "");

  out.push(`Spend by expense account, ${monthLabel(lastMonth)}`);
  if (spend.length) {
    out.push(
      table(
        [{ header: "Account" }, { header: "Net", num: true }, { header: "Lines", num: true }],
        spend.map((row) => [row.name, moneyText(row.total), String(row.lines)]),
      ),
    );
  } else {
    out.push(`  ${haveInvoices ? `No purchase invoice lines dated in ${monthLabel(lastMonth)}.` : "No invoices on file."}`);
  }
  out.push(source, "");

  out.push("Biggest customers, by sales invoiced on file");
  if (customers.length) {
    out.push(
      table(
        [{ header: "Customer" }, { header: "Invoiced on file", num: true }, { header: "Outstanding", num: true }, { header: "Invoices", num: true }],
        customers.map((c) => [c.name, moneyText(c.invoiced), c.outstanding.size ? moneyText(c.outstanding) : "none", String(c.invoices)]),
      ),
    );
  } else {
    out.push(`  ${haveInvoices ? "No sales invoices on file." : "No invoices on file."}`);
  }
  if (overdue.invoices.length) {
    out.push(`Oldest overdue: ${overdue.invoices.slice(0, 3).map((inv) => `${fmtMoney(inv.outstanding, inv.currency)} due ${fmtDate(inv.dueDate)}`).join("; ")}`);
  }
  out.push(source);

  return out.join("\n");
}
