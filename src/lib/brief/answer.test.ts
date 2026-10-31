import { describe, expect, it } from "vitest";
import type { Employee, Invoice } from "../../data/canonical/types";
import { emptyFinance, emptyHr, type Store } from "../store/store";
import { CANNOT_ANSWER, NO_FINANCE_SOURCE, answerBrief } from "./answer";

const NOW = new Date("2026-10-15T12:00:00Z");

// ---- HR ----

const person = (sourceId: string, over: Partial<Employee>): Employee => ({
  id: `bamboohr:${sourceId}`,
  source: "bamboohr",
  sourceId,
  displayName: `Person ${sourceId}`,
  title: "Engineer",
  department: "Engineering",
  location: "Denver, CO",
  managerId: null,
  hireDate: "2024-01-01",
  terminationDate: null,
  status: "active",
  ...over,
});

const hrStore: Store = {
  hr: {
    source: "bamboohr",
    syncedAt: "2026-10-15T09:00:00Z",
    employees: [
      person("1", { displayName: "Priya Raghavan", title: "VP Engineering", annualSalary: 225000, currency: "USD" }),
      person("2", { displayName: "Sofia Alvarez", managerId: "bamboohr:1", annualSalary: 165000, currency: "USD", hireDate: "2026-09-08" }),
      person("3", { displayName: "Lukas Brenner", managerId: "bamboohr:1", employmentType: "contractor", hireDate: "2026-09-21" }),
      person("4", { displayName: "Nadia Petrov", managerId: "bamboohr:1", annualSalary: 96000, currency: "EUR", hireDate: "2026-10-05" }),
      person("5", { displayName: "Jackson Reed", department: "Sales", status: "terminated", terminationDate: "2026-09-26", annualSalary: 62000, currency: "USD" }),
      person("6", { displayName: "Ling Zhao", department: "People", hireDate: "2026-11-16", annualSalary: 88000, currency: "USD" }),
    ],
  },
  finance: emptyFinance(),
  runs: [],
};

describe("answerBrief, HR", () => {
  it("counts only active people who have started, and cites the store", () => {
    const a = answerBrief("How many people?", hrStore, NOW);
    expect(a.figures[0]).toEqual({ label: "Headcount", value: "4" });
    expect(a.answer).toContain("4 people are on the payroll");
    expect(a.cited).toEqual({ source: "bamboohr", syncedAt: "2026-10-15T09:00:00Z", records: 6 });
  });

  it("treats a missing salary as a floor and reports mixed currencies separately, never as zero", () => {
    const a = answerBrief("What does the Engineering team cost?", hrStore, NOW);
    expect(a.answer).toContain("$390,000");
    expect(a.answer).toContain("EUR 96,000");
    expect(a.answer).toContain("1 of 4 have no salary on file, so this is a floor");
    expect(a.answer).not.toContain("$0");
  });

  it("answers who joined last month relative to the date given", () => {
    const a = answerBrief("who joined last month", hrStore, NOW);
    expect(a.answer).toContain("2 people joined in September 2026");
    expect(a.figures.map((f) => f.label)).toEqual(["Lukas Brenner", "Sofia Alvarez"]);
    expect(answerBrief("who left last month", hrStore, NOW).figures).toEqual([{ label: "Jackson Reed", value: "26 Sep 2026" }]);
  });

  it("refuses what it cannot ground rather than inventing", () => {
    expect(answerBrief("what is our churn", hrStore, NOW).answer).toBe(CANNOT_ANSWER);
    expect(answerBrief("who reports to Priya Raghavan", hrStore, NOW).figures.map((f) => f.label)).toEqual(["Lukas Brenner", "Nadia Petrov", "Sofia Alvarez"]);
  });
});

// ---- Finance ----

const invoice = (sourceId: string, over: Partial<Invoice>): Invoice => ({
  id: `sage:${sourceId}`,
  source: "sage",
  sourceId,
  kind: "sales",
  partyId: "sage:cust-a",
  date: "2026-09-10",
  status: "paid",
  currency: "USD",
  total: 1000,
  outstanding: 0,
  lines: [],
  ...over,
});

const financeStore: Store = {
  hr: emptyHr(),
  finance: {
    source: "sage",
    syncedAt: "2026-10-15T09:05:00Z",
    accounts: [
      { id: "sage:bank-1", source: "sage", sourceId: "bank-1", name: "Business Current Account", type: "asset" },
      { id: "sage:bank-2", source: "sage", sourceId: "bank-2", name: "Savings", type: "asset" },
      { id: "sage:7500", source: "sage", sourceId: "7500", code: "7500", name: "Software subscriptions", type: "expense" },
      { id: "sage:7100", source: "sage", sourceId: "7100", code: "7100", name: "Rent", type: "expense" },
    ],
    parties: [
      { id: "sage:cust-a", source: "sage", sourceId: "cust-a", name: "Northwind Traders", kind: "customer" },
      { id: "sage:cust-b", source: "sage", sourceId: "cust-b", name: "Contoso Ltd", kind: "customer" },
      { id: "sage:sup-1", source: "sage", sourceId: "sup-1", name: "Cloudy Hosting", kind: "supplier" },
    ],
    invoices: [
      invoice("s1", { date: "2026-09-03", total: 12000, status: "paid" }),
      invoice("s2", { date: "2026-09-18", total: 8000, status: "unpaid", outstanding: 8000, dueDate: "2026-10-02" }),
      invoice("s3", { date: "2026-09-25", total: 5000, status: "void" }),
      invoice("s4", { date: "2026-10-01", partyId: "sage:cust-b", total: 3000, status: "unpaid", outstanding: 3000, dueDate: "2026-10-31" }),
      invoice("s5", { date: "2026-10-03", partyId: "sage:cust-b", total: 2500, status: "part_paid", outstanding: 500 }),
      invoice("p1", {
        kind: "purchase",
        partyId: "sage:sup-1",
        date: "2026-09-12",
        total: 1500,
        status: "paid",
        lines: [
          { description: "Hosting", accountId: "sage:7500", net: 900 },
          { description: "Monitoring", accountId: "sage:7500", net: 350 },
          { description: "Office", accountId: "sage:7100", net: 250 },
        ],
      }),
    ],
    bankTransactions: [
      { id: "sage:t1", source: "sage", sourceId: "t1", bankAccountId: "sage:bank-1", date: "2026-09-04", amount: 12000, currency: "USD", description: "Northwind" },
      { id: "sage:t2", source: "sage", sourceId: "t2", bankAccountId: "sage:bank-1", date: "2026-09-15", amount: -1500, currency: "USD", description: "Cloudy Hosting" },
      { id: "sage:t3", source: "sage", sourceId: "t3", bankAccountId: "sage:bank-2", date: "2026-09-30", amount: 20000, currency: "USD", description: "Transfer" },
    ],
  },
  runs: [],
};

describe("answerBrief, finance", () => {
  it("sums cash from transactions per bank account and says it is not a statement", () => {
    const a = answerBrief("How much cash do we have?", financeStore, NOW);
    expect(a.answer).toContain("$30,500");
    expect(a.answer).toContain("not a statement");
    expect(a.figures).toEqual([
      { label: "Business Current Account", value: "$10,500" },
      { label: "Savings", value: "$20,000" },
      { label: "All bank accounts", value: "$30,500" },
    ]);
    expect(a.cited).toEqual({ source: "sage", syncedAt: "2026-10-15T09:05:00Z", records: 16 });
  });

  it("answers invoiced last month net of void, who is overdue, spend by account and biggest customers", () => {
    expect(answerBrief("what did we invoice last month", financeStore, NOW).answer).toContain("$20,000 was invoiced in September 2026 across 2 sales invoices");
    const overdue = answerBrief("who owes us money", financeStore, NOW);
    expect(overdue.answer).toContain("1 invoice is overdue, $8,000 outstanding");
    expect(overdue.answer).toContain("Northwind Traders $8,000 due 2 Oct 2026");
    expect(overdue.answer).toContain("1 open invoice has no due date on file");
    expect(answerBrief("what did we spend on software last month", financeStore, NOW).answer).toContain("$1,250 was spent on Software subscriptions in September 2026");
    expect(answerBrief("biggest customers", financeStore, NOW).answer).toContain("1. Northwind Traders $20,000; 2. Contoso Ltd $5,500");
    expect(answerBrief("how much cash do we have", hrStore, NOW).answer).toBe(NO_FINANCE_SOURCE);
  });
});
