/**
 * The provider seam between the canonical layer and its source systems.
 *
 * The store, the brief and the modules never touch a source API directly. They
 * read canonical records through a provider, so a new source is one more
 * provider in the registry and nothing downstream changes. That is the whole
 * point of the seam.
 */

import type {
  BankTransaction,
  FinanceSource,
  HrSource,
  Invoice,
  LedgerAccount,
  PartialEmployee,
  Party,
} from "../types";

export interface ProviderHealth {
  ok: boolean;
  /** One plain sentence: what was reached, or what went wrong. */
  detail: string;
}

export interface HrProvider {
  source: HrSource;
  /** A cheap read to say whether the source can be reached with the configured credentials. */
  health(): Promise<ProviderHealth>;
  /**
   * The full roster, normalized. Current and former people both, so the brief
   * can answer "who left". Fields the source cannot supply are absent, never
   * defaulted. May throw; runSync catches and records the error.
   */
  employees(): Promise<PartialEmployee[]>;
}

export interface FinanceProvider {
  source: FinanceSource;
  health(): Promise<ProviderHealth>;
  /** The chart of accounts, including the bank accounts. */
  accounts(): Promise<LedgerAccount[]>;
  /** Customers and suppliers. */
  parties(): Promise<Party[]>;
  /**
   * Sales and purchase invoices. `since` is an ISO timestamp: when given, the
   * provider may return only records changed since then; when omitted it
   * returns everything. runSync passes nothing today and takes the full set.
   */
  invoices(since?: string): Promise<Invoice[]>;
  bankTransactions(since?: string): Promise<BankTransaction[]>;
}

/** One provider per source, per domain. A source with no entry cannot be selected. */
export interface ProviderRegistry {
  hr: Partial<Record<HrSource, HrProvider>>;
  finance: Partial<Record<FinanceSource, FinanceProvider>>;
}
