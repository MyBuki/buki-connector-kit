/**
 * BambooHR -> canonical Employee.
 *
 * Pure: raw records in, canonical records out, no I/O. This is the only file
 * that knows both shapes. A field BambooHR does not carry for a person is left
 * absent on the canonical record. It is never defaulted, because a wrong number
 * that reads as fact is worse than a withheld one.
 */

import type { Employee, PartialEmployee } from "../types";
import type { BambooDirectoryEntry, BambooEmployeeDetail } from "./raw/types";

export const canonicalId = (sourceId: string) => `bamboohr:${sourceId}`;

/** "95000.00 USD" -> { amount: 95000, currency: "USD" }, or null when it does not parse. */
export function parsePayRate(raw: string): { amount: number; currency: string } | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s+([A-Z]{3})$/);
  if (!m) return null;
  return { amount: Number(m[1]), currency: m[2] };
}

function employmentTypeOf(raw: BambooEmployeeDetail["employmentHistoryStatus"]): Employee["employmentType"] | undefined {
  switch (raw) {
    case "Full-Time":
      return "full-time";
    case "Part-Time":
      return "part-time";
    case "Contractor":
      return "contractor";
    default:
      return undefined; // unknown or absent: say nothing rather than guess
  }
}

export function normalizeEmployee(entry: BambooDirectoryEntry, detail: BambooEmployeeDetail): PartialEmployee {
  const employee: PartialEmployee = {
    id: canonicalId(entry.id),
    source: "bamboohr",
    sourceId: entry.id,
    displayName: entry.displayName,
    title: entry.jobTitle,
    department: entry.department,
    location: entry.location,
    managerId: detail.supervisorEId ? canonicalId(detail.supervisorEId) : null,
    hireDate: detail.hireDate,
    terminationDate: detail.terminationDate ?? null,
    status: detail.status === "Active" ? "active" : "terminated",
  };

  // Salary only when BambooHR states an annual figure. An hourly rate is not an
  // annual salary; turning it into one would need an hours assumption, and an
  // assumption is not something the source said.
  if (detail.payType === "Salary" && detail.payRate) {
    const pay = parsePayRate(detail.payRate);
    if (pay) {
      employee.annualSalary = pay.amount;
      employee.currency = pay.currency;
    }
  }

  const employmentType = employmentTypeOf(detail.employmentHistoryStatus);
  if (employmentType) employee.employmentType = employmentType;
  if (entry.workEmail) employee.workEmail = entry.workEmail;
  if (detail.lastChanged) employee.sourceUpdatedAt = detail.lastChanged;

  return employee;
}

export function normalizeEmployees(
  entries: BambooDirectoryEntry[],
  details: Map<string, BambooEmployeeDetail>,
): PartialEmployee[] {
  const out: PartialEmployee[] = [];
  for (const entry of entries) {
    const detail = details.get(entry.id);
    // A directory row with no detail is a half-read person. Leaving them out is
    // honest; inventing a hire date is not.
    if (!detail) continue;
    out.push(normalizeEmployee(entry, detail));
  }
  return out;
}
