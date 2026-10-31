/**
 * One sync: for each domain with a source, pull from its provider, diff
 * against the store, write the new records, record the run.
 *
 * Each domain is independent. A finance failure does not touch the roster and
 * the other way round. Nothing here throws to its caller: a failed pull is
 * recorded as a run with ok:false and the previous records stay in place,
 * because stale data with a visible failure beats empty data with no
 * explanation. The cron route and the Sync button both call this and show
 * whatever it returns.
 */

import type { SyncRun } from "../../data/canonical/types";
import {
  activeFinanceProvider,
  activeHrProvider,
  type FinanceProvider,
  type HrProvider,
} from "../../data/canonical/providers";
import { readStore, writeStore, type FinanceStore, type Store } from "../store/store";

export interface Diff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** JSON with sorted keys, so two records that mean the same compare equal whatever their key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Added, changed and removed by id, for any canonical record type. */
export function diffRecords<T extends { id: string }>(previous: T[], next: T[]): Diff {
  const before = new Map(previous.map((r) => [r.id, stableJson(r)]));
  const after = new Map(next.map((r) => [r.id, stableJson(r)]));
  const diff: Diff = { added: [], changed: [], removed: [] };
  for (const [id, json] of after) {
    const prior = before.get(id);
    if (prior === undefined) diff.added.push(id);
    else if (prior !== json) diff.changed.push(id);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) diff.removed.push(id);
  }
  return diff;
}

function sumDiffs(diffs: Diff[]): Pick<SyncRun, "added" | "changed" | "removed"> {
  return {
    added: diffs.reduce((n, d) => n + d.added.length, 0),
    changed: diffs.reduce((n, d) => n + d.changed.length, 0),
    removed: diffs.reduce((n, d) => n + d.removed.length, 0),
  };
}

const failed = (base: Omit<SyncRun, "ok" | "pulled" | "added" | "changed" | "removed" | "durationMs" | "error">, startedMs: number, err: unknown): SyncRun => ({
  ...base,
  ok: false,
  pulled: 0,
  added: 0,
  changed: 0,
  removed: 0,
  durationMs: Date.now() - startedMs,
  error: err instanceof Error ? err.message : String(err),
});

export interface SyncReport {
  at: string;
  /** True when every domain that has a source synced. */
  ok: boolean;
  runs: SyncRun[];
}

export interface RunSyncOptions {
  /** Overrides for tests. Undefined means "ask the registry"; null for finance means "no finance source". */
  hrProvider?: HrProvider;
  financeProvider?: FinanceProvider | null;
  now?: () => Date;
}

async function syncHr(store: Store, at: string, provider?: HrProvider): Promise<SyncRun> {
  const startedMs = Date.now();
  let p: HrProvider;
  try {
    p = provider ?? activeHrProvider();
  } catch (err) {
    return failed({ at, domain: "hr", source: store.hr.source ?? "bamboohr" }, startedMs, err);
  }
  try {
    const employees = await p.employees();
    // The diff is against whatever the store held, even from another source.
    // Switching sources therefore shows every old record removed and every new
    // one added, which is what happened.
    const diff = diffRecords(store.hr.employees, employees);
    store.hr = { source: p.source, syncedAt: at, employees };
    return { at, domain: "hr", source: p.source, ok: true, pulled: employees.length, ...sumDiffs([diff]), durationMs: Date.now() - startedMs };
  } catch (err) {
    return failed({ at, domain: "hr", source: p.source }, startedMs, err);
  }
}

async function syncFinance(store: Store, at: string, provider?: FinanceProvider | null): Promise<SyncRun | null> {
  const startedMs = Date.now();
  let p: FinanceProvider | null;
  try {
    p = provider === undefined ? activeFinanceProvider() : provider;
  } catch (err) {
    return failed({ at, domain: "finance", source: store.finance.source ?? "sage" }, startedMs, err);
  }
  if (!p) return null; // no finance source configured: nothing to sync, nothing to report
  try {
    // All four pulled before anything is written, so a failure halfway leaves
    // the store as it was rather than with new invoices against old accounts.
    const [accounts, parties, invoices, bankTransactions] = await Promise.all([
      p.accounts(),
      p.parties(),
      p.invoices(),
      p.bankTransactions(),
    ]);
    const next: FinanceStore = { source: p.source, syncedAt: at, accounts, parties, invoices, bankTransactions };
    const diffs = [
      diffRecords(store.finance.accounts, accounts),
      diffRecords(store.finance.parties, parties),
      diffRecords(store.finance.invoices, invoices),
      diffRecords(store.finance.bankTransactions, bankTransactions),
    ];
    store.finance = next;
    const pulled = accounts.length + parties.length + invoices.length + bankTransactions.length;
    return { at, domain: "finance", source: p.source, ok: true, pulled, ...sumDiffs(diffs), durationMs: Date.now() - startedMs };
  } catch (err) {
    return failed({ at, domain: "finance", source: p.source }, startedMs, err);
  }
}

export async function runSync(options: RunSyncOptions = {}): Promise<SyncReport> {
  const at = (options.now ?? (() => new Date()))().toISOString();
  const store = await readStore();

  const runs: SyncRun[] = [];
  runs.push(await syncHr(store, at, options.hrProvider));
  const finance = await syncFinance(store, at, options.financeProvider);
  if (finance) runs.push(finance);

  await writeStore({ ...store, runs: [...runs, ...store.runs] });
  return { at, ok: runs.every((r) => r.ok), runs };
}
