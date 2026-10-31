/**
 * The canonical store: one JSON file at .data/store.json.
 *
 * In Buki proper this is a database with a snapshot per tenant. Here a file is
 * enough, and it keeps the shape visible: open it after a sync and you see
 * exactly what the modules and the brief read. Nothing reads a source API at
 * request time; everything reads this.
 *
 * Each domain has its own source and synced-at, because each syncs on its own.
 * A finance failure never touches the roster, and the other way round.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BankTransaction,
  Employee,
  FinanceSource,
  HrSource,
  Invoice,
  LedgerAccount,
  Party,
  SyncRun,
} from "../../data/canonical/types";

export interface HrStore {
  /** The source the employees came from. Null until the first successful sync. */
  source: HrSource | null;
  /** When the employees were last pulled. Null until the first successful sync. */
  syncedAt: string | null;
  employees: Employee[];
}

export interface FinanceStore {
  source: FinanceSource | null;
  syncedAt: string | null;
  accounts: LedgerAccount[];
  parties: Party[];
  invoices: Invoice[];
  bankTransactions: BankTransaction[];
}

export interface Store {
  hr: HrStore;
  finance: FinanceStore;
  /** Most recent first, both domains. Failed runs are kept too, so a quiet failure is visible. */
  runs: SyncRun[];
}

const RUNS_KEPT = 50;

export const STORE_PATH = path.join(process.cwd(), ".data", "store.json");

export const emptyHr = (): HrStore => ({ source: null, syncedAt: null, employees: [] });
export const emptyFinance = (): FinanceStore => ({
  source: null,
  syncedAt: null,
  accounts: [],
  parties: [],
  invoices: [],
  bankTransactions: [],
});
export const emptyStore = (): Store => ({ hr: emptyHr(), finance: emptyFinance(), runs: [] });

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function readStore(): Promise<Store> {
  let text: string;
  try {
    text = await readFile(STORE_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
  const parsed = JSON.parse(text) as Partial<Store>;
  const hr: Partial<HrStore> = parsed.hr ?? {};
  const fin: Partial<FinanceStore> = parsed.finance ?? {};
  return {
    hr: { source: hr.source ?? null, syncedAt: hr.syncedAt ?? null, employees: list(hr.employees) },
    finance: {
      source: fin.source ?? null,
      syncedAt: fin.syncedAt ?? null,
      accounts: list(fin.accounts),
      parties: list(fin.parties),
      invoices: list(fin.invoices),
      bankTransactions: list(fin.bankTransactions),
    },
    runs: list(parsed.runs),
  };
}

/** Write to a temp file and rename, so a reader never sees a half-written store. */
export async function writeStore(store: Store): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  const trimmed: Store = { ...store, runs: store.runs.slice(0, RUNS_KEPT) };
  await writeFile(tmp, JSON.stringify(trimmed, null, 2) + "\n", "utf8");
  await rename(tmp, STORE_PATH);
}
