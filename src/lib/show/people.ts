/**
 * The People module as text: what the satellite's /people page shows, section
 * by section, each ending with its citation. Pure: the HR store and a date in,
 * a string out. It reads the same figures the brief reads, so a table here and
 * an answer there can never disagree.
 */

import type { Employee } from "../../data/canonical/types";
import { fmtDate, fmtMoney, monthLabel } from "../format";
import { byName, costByDepartment, headcount, joinedIn, leftIn, periodsOf } from "../people/figures";
import type { HrStore } from "../store/store";
import { NOTHING_SYNCED } from "../brief/answer";
import { cite, table } from "./table";

const EMPLOYMENT: Record<NonNullable<Employee["employmentType"]>, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  contractor: "Contractor",
};

const NOT_ON_FILE = "not on file";

function statusText(e: Employee, today: string): string {
  if (e.status === "terminated") return e.terminationDate ? `Left ${fmtDate(e.terminationDate)}` : "Left";
  if (e.hireDate > today) return `Starts ${fmtDate(e.hireDate)}`;
  return "Active";
}

function peopleList(rows: Employee[]): string {
  if (!rows.length) return "  none";
  return rows.map((e) => `  ${e.displayName}  ${e.title}, ${e.department}`).join("\n");
}

export function renderPeople(hr: HrStore, now: Date): string {
  const people = hr.employees;
  if (!hr.source || !people.length) {
    return `People\n\n${NOTHING_SYNCED}\nIn the kit, that is npm run sync.`;
  }

  const { today, thisMonth, lastMonth } = periodsOf(now);
  const source = cite(hr.source, hr.syncedAt);
  const { onPayroll, notStarted } = headcount(people, today);
  const byId = new Map(people.map((e) => [e.id, e]));
  const out: string[] = [];

  out.push("People", source, "");

  out.push(`Headcount: ${onPayroll.length}${notStarted.length ? ` (${notStarted.length} more with a start date after today)` : ""}`);
  out.push(`Joined in ${monthLabel(thisMonth)}: ${joinedIn(people, thisMonth).length}`);
  out.push(peopleList(joinedIn(people, thisMonth)));
  out.push(`Joined in ${monthLabel(lastMonth)}: ${joinedIn(people, lastMonth).length}`);
  out.push(peopleList(joinedIn(people, lastMonth)));
  out.push(`Left in ${monthLabel(thisMonth)}: ${leftIn(people, thisMonth).length}`);
  out.push(peopleList(leftIn(people, thisMonth)));
  out.push(source, "");

  out.push("Cost by department, annual base salary");
  out.push(
    table(
      [{ header: "Department" }, { header: "People", num: true }, { header: "Annual base", num: true }, { header: "Coverage" }],
      costByDepartment(people, today).map(({ department, pay }) => [
        department,
        String(pay.members),
        pay.totals.size ? [...pay.totals].map(([ccy, t]) => fmtMoney(t.sum, ccy)).join(" and ") : NOT_ON_FILE,
        pay.missing ? `${pay.missing} of ${pay.members} not on file, so this is a floor` : "everyone on file",
      ]),
    ),
  );
  out.push(source, "");

  out.push("Roster");
  out.push(
    table(
      [
        { header: "Name" },
        { header: "Title" },
        { header: "Department" },
        { header: "Location" },
        { header: "Manager" },
        { header: "Type" },
        { header: "Start" },
        { header: "Status" },
        { header: "Annual base", num: true },
      ],
      [...people].sort(byName).map((e) => [
        e.displayName,
        e.title,
        e.department,
        e.location,
        e.managerId ? (byId.get(e.managerId)?.displayName ?? NOT_ON_FILE) : "none",
        e.employmentType ? EMPLOYMENT[e.employmentType] : NOT_ON_FILE,
        fmtDate(e.hireDate),
        statusText(e, today),
        typeof e.annualSalary === "number" && e.currency ? fmtMoney(e.annualSalary, e.currency) : NOT_ON_FILE,
      ]),
    ),
  );
  out.push(source);

  return out.join("\n");
}
