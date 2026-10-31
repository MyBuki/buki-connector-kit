/**
 * The brief: a question in, a grounded answer out. No model, no guessing.
 *
 * Every answer is computed from the store and cites it (source, synced-at,
 * record count). A question the patterns do not cover gets a plain refusal,
 * and a figure the source did not supply is said to be missing rather than
 * treated as zero. That last rule is the one a connector must not break: the
 * brief can only be honest about a missing salary or an invoice with no due
 * date if normalize() left the field absent.
 *
 * Two groups of patterns, one per domain. Each reads only its own part of the
 * store and cites only that.
 */

import { SOURCE_LABEL, type AnySource, type Employee } from "../../data/canonical/types";
import type { FinanceStore, HrStore, Store } from "../store/store";
import { fmtDate, fmtMoney, monthBefore, monthLabel, monthNumber, plural, yearMonth } from "../format";
import {
  costByDepartment,
  findDepartment,
  findPerson,
  headcount,
  isOnPayroll,
  joinedIn,
  leftIn,
  byName,
  payTotals,
  periodsOf,
} from "../people/figures";
import {
  biggestCustomers,
  cashByBankAccount,
  overdueReceivables,
  salesInvoicedIn,
  spendOnAccountIn,
  topCustomersByOutstanding,
  type Money,
} from "../finance/figures";

export interface Figure {
  label: string;
  value: string;
}

export interface Citation {
  source: AnySource | null;
  syncedAt: string | null;
  records: number;
}

export interface BriefAnswer {
  answer: string;
  figures: Figure[];
  cited: Citation;
}

export const CANNOT_ANSWER = "Buki cannot answer that from HR or finance data yet.";
export const NOTHING_SYNCED = "Nothing has been synced yet. Press Sync now on the home page, then ask again.";
export const NO_FINANCE_SOURCE = "No finance source connected yet. Set FINANCE_SOURCE=sage once the Sage connector is registered.";

export function answerBrief(question: string, store: Store, now: Date = new Date()): BriefAnswer {
  const q = question.trim().toLowerCase().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  const hrCited: Citation = { source: store.hr.source, syncedAt: store.hr.syncedAt, records: store.hr.employees.length };
  if (!q) return { answer: CANNOT_ANSWER, figures: [], cited: hrCited };

  for (const rule of FINANCE_RULES) {
    const m = q.match(rule.pattern);
    if (!m) continue;
    const fin = store.finance;
    const cited: Citation = {
      source: fin.source,
      syncedAt: fin.syncedAt,
      records: fin.accounts.length + fin.parties.length + fin.invoices.length + fin.bankTransactions.length,
    };
    if (!fin.source) return { answer: NO_FINANCE_SOURCE, figures: [], cited };
    return rule.answer(m, { fin, now, cited, sourceLabel: SOURCE_LABEL[fin.source] });
  }

  for (const rule of HR_RULES) {
    const m = q.match(rule.pattern);
    if (!m) continue;
    if (!store.hr.source || store.hr.employees.length === 0) return { answer: NOTHING_SYNCED, figures: [], cited: hrCited };
    return rule.answer(m, { people: store.hr.employees, now, cited: hrCited, sourceLabel: SOURCE_LABEL[store.hr.source] });
  }

  return { answer: CANNOT_ANSWER, figures: [], cited: hrCited };
}

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

interface Rule<C> {
  pattern: RegExp;
  answer: (m: RegExpMatchArray, ctx: C) => BriefAnswer;
}

const cite = (ctx: { sourceLabel: string; cited: Citation }) => `${ctx.sourceLabel}, synced ${fmtDate(ctx.cited.syncedAt)}`;

/**
 * "last month" / "this month" / "in september" / "in september 2025" -> "YYYY-MM".
 * A bare month name means the most recent one that has started, so "August"
 * asked in October 2026 is August 2026 and "December" is December 2025.
 */
function resolveMonth(phrase: string, now: Date): string | null {
  const current = yearMonth(now);
  const p = phrase.trim().toLowerCase();
  if (p === "last month") return monthBefore(current);
  if (p === "this month") return current;
  const m = p.match(/^(?:in\s+)?([a-z]+)(?:\s+(\d{4}))?$/);
  if (!m) return null;
  const month = monthNumber(m[1]);
  if (!month) return null;
  const mm = String(month).padStart(2, "0");
  if (m[2]) return `${m[2]}-${mm}`;
  const thisYear = `${now.getUTCFullYear()}-${mm}`;
  return thisYear <= current ? thisYear : `${now.getUTCFullYear() - 1}-${mm}`;
}

const MONTH_PHRASE = String.raw`(last month|this month|in\s+[a-z]+(?:\s+\d{4})?|[a-z]+\s+\d{4})`;

/** "$1,200,000 and EUR 96,000" */
const moneyList = (money: Money): string => [...money].map(([ccy, amount]) => fmtMoney(amount, ccy)).join(" and ");

const moneyFigures = (label: string, money: Money): Figure[] => [...money].map(([ccy, amount]) => ({ label: money.size > 1 ? `${label} (${ccy})` : label, value: fmtMoney(amount, ccy) }));

const notConverted = (money: Money): string => (money.size > 1 ? " (more than one currency on file, not converted)" : "");

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------

interface HrCtx {
  people: Employee[];
  now: Date;
  cited: Citation;
  sourceLabel: string;
}

const line = (e: Employee) => `${e.displayName} (${e.title}, ${e.department})`;

function noDepartment(raw: string, ctx: HrCtx): BriefAnswer {
  const names = [...new Set(ctx.people.map((e) => e.department))].sort();
  return {
    answer: `There is no department called "${raw.trim()}" on file. The departments are ${names.join(", ")}. By ${cite(ctx)}.`,
    figures: [],
    cited: ctx.cited,
  };
}

const HR_RULES: Rule<HrCtx>[] = [
  {
    pattern: /^(?:how many people|how many employees|headcount|head count)(?:\s.*)?$/,
    answer: (_m, ctx) => {
      const { today } = periodsOf(ctx.now);
      const { onPayroll, notStarted } = headcount(ctx.people, today);
      const figures: Figure[] = [{ label: "Headcount", value: String(onPayroll.length) }];
      if (notStarted.length) figures.push({ label: "Not started yet", value: String(notStarted.length) });
      const extra = notStarted.length
        ? ` ${plural(notStarted.length, "more person", "more people")} ha${notStarted.length === 1 ? "s" : "ve"} a start date after today.`
        : "";
      return { answer: `${onPayroll.length} people are on the payroll today, by ${cite(ctx)}.${extra}`, figures, cited: ctx.cited };
    },
  },
  {
    pattern: new RegExp(String.raw`^who (joined|started|left|departed)(?:\s+(?:us|the company))?\s+${MONTH_PHRASE}$`),
    answer: (m, ctx) => {
      const leaving = m[1] === "left" || m[1] === "departed";
      const ym = resolveMonth(m[2], ctx.now);
      if (!ym) return { answer: CANNOT_ANSWER, figures: [], cited: ctx.cited };
      const hits = leaving ? leftIn(ctx.people, ym) : joinedIn(ctx.people, ym);
      const verb = leaving ? "left" : "joined";
      if (!hits.length) {
        return {
          answer: `No one on file ${verb} in ${monthLabel(ym)}, by ${cite(ctx)}.`,
          figures: [{ label: `${leaving ? "Left" : "Joined"} in ${monthLabel(ym)}`, value: "0" }],
          cited: ctx.cited,
        };
      }
      return {
        answer: `${plural(hits.length, "person", "people")} ${verb} in ${monthLabel(ym)}: ${hits.map(line).join("; ")}. By ${cite(ctx)}.`,
        figures: hits.map((e) => ({ label: e.displayName, value: fmtDate(leaving ? e.terminationDate : e.hireDate) })),
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: /^who (?:has )?left(?:\s+(?:us|the company))?$/,
    answer: (_m, ctx) => {
      const gone = ctx.people
        .filter((e) => e.status === "terminated")
        .sort((a, b) => (b.terminationDate ?? "").localeCompare(a.terminationDate ?? ""));
      if (!gone.length) return { answer: `No one on file has left, by ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      const shown = gone.slice(0, 10);
      return {
        answer: `${plural(gone.length, "person has", "people have")} left: ${shown.map((e) => `${e.displayName} on ${fmtDate(e.terminationDate) || "a date not on file"}`).join("; ")}${gone.length > shown.length ? "; and more" : ""}. By ${cite(ctx)}.`,
        figures: shown.map((e) => ({ label: e.displayName, value: fmtDate(e.terminationDate) || "not on file" })),
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: /^(?:what does (?:the )?(.+?) (?:team |department )?cost|(?:what is |what's )?(?:the )?(.+?) (?:team |department )?cost)(?:\s+(?:per year|a year|annually))?$/,
    answer: (m, ctx) => {
      const raw = m[1] ?? m[2];
      const dept = findDepartment(ctx.people, raw);
      if (!dept) return noDepartment(raw, ctx);
      const { today } = periodsOf(ctx.now);
      const row = costByDepartment(ctx.people, today).find((r) => r.department === dept);
      if (!row || row.pay.members === 0) return { answer: `No one is on the payroll in ${dept} today, by ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      const { totals, missing, members } = row.pay;
      const figures: Figure[] = [...totals].map(([ccy, t]) => ({ label: `${dept}, annual base (${ccy})`, value: fmtMoney(t.sum, ccy) }));
      figures.push({ label: "People counted", value: String(members) });
      if (missing) figures.push({ label: "No salary on file", value: String(missing) });
      if (!totals.size) {
        return {
          answer: `${dept} has ${plural(members, "person", "people")} on the payroll and none of them has a salary on file, so there is no figure to give. By ${cite(ctx)}.`,
          figures,
          cited: ctx.cited,
        };
      }
      const parts = [...totals].map(([ccy, t]) => `${fmtMoney(t.sum, ccy)} a year in base salary across ${plural(t.count, "person", "people")}`);
      const floor = missing ? `${missing} of ${members} have no salary on file, so this is a floor. ` : "";
      return {
        answer: `${dept} costs ${parts.join(" and ")}${totals.size > 1 ? " (two currencies on file, not converted)" : ""}. ${floor}By ${cite(ctx)}.`,
        figures,
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: /^(?:what is |what's )?(?:the )?average (?:base )?(?:salary|pay) (?:in|for|of) (?:the )?(.+?)(?: team| department)?$/,
    answer: (m, ctx) => {
      const dept = findDepartment(ctx.people, m[1]);
      if (!dept) return noDepartment(m[1], ctx);
      const { today } = periodsOf(ctx.now);
      const members = ctx.people.filter((e) => e.department === dept && isOnPayroll(e, today));
      const { totals, missing } = payTotals(members);
      if (!totals.size) {
        return { answer: `No one in ${dept} has a salary on file, so there is no average to give. By ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      }
      const parts = [...totals].map(([ccy, t]) => `${fmtMoney(t.sum / t.count, ccy)} across ${plural(t.count, "person", "people")}`);
      const figures: Figure[] = [...totals].map(([ccy, t]) => ({ label: `${dept}, average base (${ccy})`, value: fmtMoney(t.sum / t.count, ccy) }));
      if (missing) figures.push({ label: "No salary on file", value: String(missing) });
      return {
        answer: `The average base salary in ${dept} is ${parts.join(" and ")}${totals.size > 1 ? " (two currencies on file, not converted)" : ""}. ${missing ? `${missing} of ${members.length} have no salary on file and are left out of the average. ` : ""}By ${cite(ctx)}.`,
        figures,
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: /^who reports to (.+)$/,
    answer: (m, ctx) => {
      const matches = findPerson(ctx.people, m[1]);
      if (!matches.length) return { answer: `There is no one called "${m[1].trim()}" on file, by ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      if (matches.length > 1) {
        return {
          answer: `More than one person matches "${m[1].trim()}": ${matches.map((e) => e.displayName).join(", ")}. Ask with the full name.`,
          figures: [],
          cited: ctx.cited,
        };
      }
      const boss = matches[0];
      const { today } = periodsOf(ctx.now);
      const reports = ctx.people.filter((e) => e.managerId === boss.id && isOnPayroll(e, today)).sort(byName);
      if (!reports.length) return { answer: `No one on the payroll reports to ${boss.displayName}, by ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      return {
        answer: `${plural(reports.length, "person reports", "people report")} to ${boss.displayName}: ${reports.map(line).join("; ")}. By ${cite(ctx)}.`,
        figures: reports.map((e) => ({ label: e.displayName, value: e.title })),
        cited: ctx.cited,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

interface FinCtx {
  fin: FinanceStore;
  now: Date;
  cited: Citation;
  sourceLabel: string;
}

const FINANCE_RULES: Rule<FinCtx>[] = [
  {
    pattern: /^(?:how much cash do we have|how much cash(?: is there)?|what is our cash(?: position| balance)?|cash position|cash balance)(?:\s+(?:today|now|right now))?$/,
    answer: (_m, ctx) => {
      if (!ctx.fin.bankTransactions.length) {
        return { answer: `No bank transactions are on file from ${ctx.sourceLabel}, so there is no cash figure to give.`, figures: [], cited: ctx.cited };
      }
      const rows = cashByBankAccount(ctx.fin.bankTransactions, ctx.fin.accounts);
      const total: Money = new Map();
      for (const r of rows) for (const [ccy, v] of r.balance) total.set(ccy, (total.get(ccy) ?? 0) + v);
      const figures: Figure[] = rows.flatMap((r) => moneyFigures(r.name, r.balance));
      figures.push(...moneyFigures("All bank accounts", total));
      return {
        answer: `Cash is ${moneyList(total)} across ${plural(rows.length, "bank account")}, summed from the transactions on file (not a statement balance)${notConverted(total)}. By ${cite(ctx)}.`,
        figures,
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: new RegExp(String.raw`^(?:what did we invoice|what did we bill|how much did we invoice|how much did we bill|revenue|sales|what was (?:our )?revenue|what were (?:our )?sales)\s+${MONTH_PHRASE}$`),
    answer: (m, ctx) => {
      const ym = resolveMonth(m[1], ctx.now);
      if (!ym) return { answer: CANNOT_ANSWER, figures: [], cited: ctx.cited };
      if (!ctx.fin.invoices.length) {
        return { answer: `No invoices are on file from ${ctx.sourceLabel}, so there is no figure for ${monthLabel(ym)}.`, figures: [], cited: ctx.cited };
      }
      const { total, count } = salesInvoicedIn(ctx.fin.invoices, ym);
      if (!count) {
        return { answer: `No sales invoices are dated in ${monthLabel(ym)}, by ${cite(ctx)}.`, figures: [{ label: `Invoiced in ${monthLabel(ym)}`, value: "none dated this month" }], cited: ctx.cited };
      }
      return {
        answer: `${moneyList(total)} was invoiced in ${monthLabel(ym)} across ${plural(count, "sales invoice")}, void and draft invoices left out${notConverted(total)}. By ${cite(ctx)}.`,
        figures: [...moneyFigures(`Invoiced in ${monthLabel(ym)}`, total), { label: "Sales invoices", value: String(count) }],
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: /^(?:who owes us(?: money)?|overdue invoices|what is overdue|what's overdue|overdue receivables|which invoices are overdue)$/,
    answer: (_m, ctx) => {
      if (!ctx.fin.invoices.length) {
        return { answer: `No invoices are on file from ${ctx.sourceLabel}, so there is nothing to call overdue.`, figures: [], cited: ctx.cited };
      }
      const { today } = periodsOf(ctx.now);
      const { invoices, total, noDueDate } = overdueReceivables(ctx.fin.invoices, today);
      const names = new Map(ctx.fin.parties.map((p) => [p.id, p.name]));
      const noDue = noDueDate ? ` ${plural(noDueDate, "open invoice has", "open invoices have")} no due date on file and ${noDueDate === 1 ? "is" : "are"} not counted.` : "";
      if (!invoices.length) {
        return { answer: `Nothing is overdue today, by ${cite(ctx)}.${noDue}`, figures: [{ label: "Overdue invoices", value: "0" }], cited: ctx.cited };
      }
      const shown = invoices.slice(0, 10);
      return {
        answer: `${plural(invoices.length, "invoice is", "invoices are")} overdue, ${moneyList(total)} outstanding${notConverted(total)}: ${shown.map((inv) => `${names.get(inv.partyId) ?? "customer not on file"} ${fmtMoney(inv.outstanding, inv.currency)} due ${fmtDate(inv.dueDate)}`).join("; ")}${invoices.length > shown.length ? "; and more" : ""}. By ${cite(ctx)}.${noDue}`,
        figures: [...moneyFigures("Overdue outstanding", total), { label: "Overdue invoices", value: String(invoices.length) }],
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: new RegExp(String.raw`^(?:what did we spend on|how much did we spend on|spend on|spending on) (.+?)\s+${MONTH_PHRASE}$`),
    answer: (m, ctx) => {
      const ym = resolveMonth(m[2], ctx.now);
      if (!ym) return { answer: CANNOT_ANSWER, figures: [], cited: ctx.cited };
      if (!ctx.fin.invoices.length) {
        return { answer: `No invoices are on file from ${ctx.sourceLabel}, so there is no spend figure for ${monthLabel(ym)}.`, figures: [], cited: ctx.cited };
      }
      const rows = spendOnAccountIn(ctx.fin.invoices, ctx.fin.accounts, ym, m[1]);
      if (!rows.length) {
        return { answer: `No purchase invoice lines in ${monthLabel(ym)} are posted to an account called "${m[1].trim()}", by ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      }
      const total: Money = new Map();
      for (const r of rows) for (const [ccy, v] of r.total) total.set(ccy, (total.get(ccy) ?? 0) + v);
      const lines = rows.reduce((n, r) => n + r.lines, 0);
      return {
        answer: `${moneyList(total)} was spent on ${rows.map((r) => r.name).join(", ")} in ${monthLabel(ym)}, from ${plural(lines, "purchase invoice line")}${notConverted(total)}. By ${cite(ctx)}.`,
        figures: rows.flatMap((r) => moneyFigures(r.name, r.total)),
        cited: ctx.cited,
      };
    },
  },
  {
    pattern: /^(?:(?:who are )?(?:our )?biggest customers|top customers|largest customers|(?:who are )?(?:our )?top (?:five|5) customers)$/,
    answer: (_m, ctx) => {
      if (!ctx.fin.invoices.length) {
        return { answer: `No invoices are on file from ${ctx.sourceLabel}, so there is no customer ranking to give.`, figures: [], cited: ctx.cited };
      }
      const top = biggestCustomers(ctx.fin.invoices, ctx.fin.parties, 5);
      if (!top.length) return { answer: `No sales invoices are on file, by ${cite(ctx)}.`, figures: [], cited: ctx.cited };
      const owing = topCustomersByOutstanding(ctx.fin.invoices, ctx.fin.parties, 5);
      const owingNote = owing.length ? ` Most outstanding: ${owing.map((c) => `${c.name} ${moneyList(c.outstanding)}`).join("; ")}.` : "";
      return {
        answer: `By sales invoiced on file: ${top.map((c, i) => `${i + 1}. ${c.name} ${moneyList(c.invoiced)}`).join("; ")}. By ${cite(ctx)}.${owingNote}`,
        figures: top.flatMap((c) => moneyFigures(c.name, c.invoiced)),
        cited: ctx.cited,
      };
    },
  },
];

export type { HrStore };
