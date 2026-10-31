/**
 * Pins the sample's figures. If sample/finance.sample.json changes, the README
 * table and these numbers must change together.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { answerBrief } from "../brief/answer";
import { biggestCustomers, cashByBankAccount, overdueReceivables, salesInvoicedIn, spendOnAccountIn, sumAll } from "../finance/figures";
import { renderFinance } from "../show/finance";
import { emptyHr, type Store } from "../store/store";
import { validateFinanceSet } from "./validate";

const SAMPLE_PATH = new URL("../../../sample/finance.sample.json", import.meta.url);
const NOW = new Date("2026-10-30T12:00:00Z");

const result = validateFinanceSet(JSON.parse(readFileSync(SAMPLE_PATH, "utf8")));
const fin = result.set!;
const store: Store = { hr: emptyHr(), finance: { source: "sage", syncedAt: NOW.toISOString(), ...fin }, runs: [] };

describe("the Halden Labs sample, asked in October 2026", () => {
  it("is valid", () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("has $63,520 in the operating account and $190,095 in reserve", () => {
    const cash = cashByBankAccount(fin.bankTransactions, fin.accounts);
    expect(cash.map((c) => [c.name, c.balance.get("USD"), c.transactions])).toEqual([
      ["Operating account", 63520, 7],
      ["Reserve account", 190095, 3],
    ]);
    expect(answerBrief("how much cash do we have", store, NOW).answer).toContain("Cash is $253,615 across 2 bank accounts");
  });

  it("invoiced $33,500 in September and $12,000 in October, void and draft left out", () => {
    expect(salesInvoicedIn(fin.invoices, "2026-09")).toEqual({ total: new Map([["USD", 33500]]), count: 3 });
    expect(salesInvoicedIn(fin.invoices, "2026-10")).toEqual({ total: new Map([["USD", 12000]]), count: 1 });
    expect(answerBrief("what did we invoice last month", store, NOW).answer).toContain("$33,500 was invoiced in September 2026 across 3 sales invoices");
  });

  it("has 2 overdue invoices worth $12,000 and 1 open invoice with no due date", () => {
    const overdue = overdueReceivables(fin.invoices, "2026-10-30");
    expect(overdue.invoices.map((i) => i.id)).toEqual(["sage:si-3002", "sage:si-3003"]);
    expect(sumAll(overdue.total)).toBe(12000);
    expect(overdue.noDueDate).toBe(1);
    const a = answerBrief("who owes us money", store, NOW).answer;
    expect(a).toContain("2 invoices are overdue, $12,000 outstanding: Pinecrest Health $9,500 due 15 Oct 2026; Tolliver & Reed LLP $2,500 due 22 Oct 2026");
    expect(a).toContain("1 open invoice has no due date on file and is not counted");
  });

  it("spent $300 on software in September and $2,350 in October", () => {
    expect(spendOnAccountIn(fin.invoices, fin.accounts, "2026-09", "software").map((r) => [r.name, r.total.get("USD"), r.lines])).toEqual([["Software subscriptions", 300, 1]]);
    expect(spendOnAccountIn(fin.invoices, fin.accounts, "2026-10", "software").map((r) => [r.name, r.total.get("USD"), r.lines])).toEqual([["Software subscriptions", 2350, 2]]);
    expect(answerBrief("what did we spend on software last month", store, NOW).answer).toContain("$300 was spent on Software subscriptions in September 2026, from 1 purchase invoice line");
    expect(answerBrief("what did we spend on software in october", store, NOW).answer).toContain("$2,350 was spent on Software subscriptions in October 2026, from 2 purchase invoice lines");
  });

  it("ranks Northgate Analytics first at $30,000 invoiced", () => {
    const top = biggestCustomers(fin.invoices, fin.parties, 5);
    expect(top.map((c) => [c.name, c.invoiced.get("USD"), c.outstanding.get("USD") ?? 0, c.invoices])).toEqual([
      ["Northgate Analytics", 30000, 12000, 2],
      ["Pinecrest Health", 9500, 9500, 1],
      ["Tolliver & Reed LLP", 6000, 2500, 1],
    ]);
    expect(answerBrief("biggest customers", store, NOW).answer).toContain("1. Northgate Analytics $30,000; 2. Pinecrest Health $9,500; 3. Tolliver & Reed LLP $6,000");
  });

  it("renders the Finance module with a citation under every section", () => {
    const text = renderFinance(store.finance, NOW);
    expect(text).toContain("  Operating account   $63,520             7");
    expect(text).toContain("Invoiced in September 2026: $33,500 (3 sales invoices, void and draft left out)");
    expect(text).toContain("Overdue receivables: $12,000 (2 open sales invoices past due; 1 open with no due date on file, not counted)");
    expect(text).toContain("Spend by expense account, September 2026");
    expect(text.split("\n").filter((l) => l === "Sage, synced 30 Oct 2026, 12:00 UTC")).toHaveLength(5);
  });
});
