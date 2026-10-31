import { describe, expect, it } from "vitest";
import { normalizeEmployee, normalizeEmployees, parsePayRate } from "./normalize";
import type { BambooDirectoryEntry, BambooEmployeeDetail } from "./raw/types";

const entry = (over: Partial<BambooDirectoryEntry> = {}): BambooDirectoryEntry => ({
  id: "111",
  displayName: "Sofia Alvarez",
  firstName: "Sofia",
  lastName: "Alvarez",
  jobTitle: "Senior Software Engineer",
  department: "Engineering",
  location: "Denver, CO",
  supervisor: "Wei Zhang",
  workEmail: "sofia.alvarez@haldenlabs.example",
  ...over,
});

const detail = (over: Partial<BambooEmployeeDetail> = {}): BambooEmployeeDetail => ({
  id: "111",
  hireDate: "2023-06-05",
  terminationDate: null,
  status: "Active",
  supervisorEId: "110",
  payRate: "165000.00 USD",
  payType: "Salary",
  employmentHistoryStatus: "Full-Time",
  lastChanged: "2026-08-31T14:05:00+00:00",
  ...over,
});

describe("normalizeEmployee", () => {
  it("maps a salaried employee onto the canonical shape with prefixed ids", () => {
    const e = normalizeEmployee(entry(), detail());
    expect(e).toMatchObject({
      id: "bamboohr:111",
      source: "bamboohr",
      sourceId: "111",
      managerId: "bamboohr:110",
      status: "active",
      annualSalary: 165000,
      currency: "USD",
      employmentType: "full-time",
      workEmail: "sofia.alvarez@haldenlabs.example",
      sourceUpdatedAt: "2026-08-31T14:05:00+00:00",
    });
    expect(parsePayRate("95000.00 USD")).toEqual({ amount: 95000, currency: "USD" });
  });

  it("leaves salary and currency absent for a contractor with no pay record, never 0", () => {
    const raw = detail({ employmentHistoryStatus: "Contractor" });
    delete raw.payRate;
    delete raw.payType;
    const e = normalizeEmployee(entry({ id: "119", displayName: "Lukas Brenner" }), raw);
    expect(e.employmentType).toBe("contractor");
    expect("annualSalary" in e).toBe(false);
    expect("currency" in e).toBe(false);
  });

  it("treats an hourly rate as no annual salary, and Inactive as terminated", () => {
    const e = normalizeEmployee(
      entry({ id: "134", displayName: "Emily Carter" }),
      detail({ id: "134", payRate: "29.00 USD", payType: "Hourly", status: "Inactive", terminationDate: "2026-09-26" }),
    );
    expect("annualSalary" in e).toBe(false);
    expect(e.status).toBe("terminated");
    expect(e.terminationDate).toBe("2026-09-26");
  });

  it("skips a directory row that has no detail rather than inventing one", () => {
    const rows = normalizeEmployees([entry(), entry({ id: "999", displayName: "Nobody" })], new Map([["111", detail()]]));
    expect(rows.map((r) => r.sourceId)).toEqual(["111"]);
  });
});
