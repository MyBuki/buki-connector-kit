/**
 * The People figures, computed once here and read by both the People module
 * and the brief, so a question and a page can never disagree about a number.
 *
 * Pure: records and a date in, figures out. A salary the source did not supply
 * is counted as "not on file" and never as 0.
 */

import type { Employee } from "../../data/canonical/types";
import { isoDate, monthBefore, yearMonth } from "../format";

/** Active and already started. Someone with a future start date is not headcount yet. */
export const isOnPayroll = (e: Employee, today: string): boolean => e.status === "active" && e.hireDate <= today;

export const byName = (a: Employee, b: Employee): number => a.displayName.localeCompare(b.displayName);

export interface Periods {
  today: string;
  thisMonth: string;
  lastMonth: string;
}

export function periodsOf(now: Date): Periods {
  const thisMonth = yearMonth(now);
  return { today: isoDate(now), thisMonth, lastMonth: monthBefore(thisMonth) };
}

export function headcount(people: Employee[], today: string) {
  return {
    onPayroll: people.filter((e) => isOnPayroll(e, today)),
    notStarted: people.filter((e) => e.status === "active" && e.hireDate > today),
  };
}

export const joinedIn = (people: Employee[], ym: string): Employee[] =>
  people.filter((e) => e.hireDate.startsWith(ym)).sort(byName);

export const leftIn = (people: Employee[], ym: string): Employee[] =>
  people.filter((e) => (e.terminationDate ?? "").startsWith(ym)).sort(byName);

export interface PayTotals {
  /** Per currency: the sum of known salaries and how many people it covers. */
  totals: Map<string, { sum: number; count: number }>;
  /** People with no salary on file. Never added as 0. */
  missing: number;
  members: number;
}

export function payTotals(members: Employee[]): PayTotals {
  const totals = new Map<string, { sum: number; count: number }>();
  let missing = 0;
  for (const e of members) {
    if (typeof e.annualSalary !== "number" || !e.currency) {
      missing += 1;
      continue;
    }
    const t = totals.get(e.currency) ?? { sum: 0, count: 0 };
    t.sum += e.annualSalary;
    t.count += 1;
    totals.set(e.currency, t);
  }
  return { totals, missing, members: members.length };
}

export const departmentsOf = (people: Employee[]): string[] => [...new Set(people.map((e) => e.department))].sort();

export function costByDepartment(people: Employee[], today: string): { department: string; pay: PayTotals }[] {
  const on = people.filter((e) => isOnPayroll(e, today));
  return departmentsOf(on).map((department) => ({
    department,
    pay: payTotals(on.filter((e) => e.department === department)),
  }));
}

export function findDepartment(people: Employee[], raw: string): string | null {
  const wanted = raw.trim().toLowerCase().replace(/^the\s+/, "").replace(/\s+(team|department|dept)$/, "");
  const names = departmentsOf(people);
  return (
    names.find((n) => n.toLowerCase() === wanted) ??
    names.find((n) => n.toLowerCase().startsWith(wanted) || wanted.startsWith(n.toLowerCase())) ??
    null
  );
}

/** Exact display name first, then a single word of it ("Marcus"). */
export function findPerson(people: Employee[], raw: string): Employee[] {
  const wanted = raw.trim().toLowerCase();
  const exact = people.filter((e) => e.displayName.toLowerCase() === wanted);
  if (exact.length) return exact;
  return people.filter((e) => e.displayName.toLowerCase().split(/\s+/).includes(wanted));
}
