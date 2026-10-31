/**
 * The provider registry, keyed by HR_SOURCE and FINANCE_SOURCE.
 *
 * To add a source: build a provider under src/data/canonical/<source>/, register
 * it here under its domain, and set the matching environment variable. Nothing
 * else in the app knows which source is active; it asks this file.
 */

import { FINANCE_SOURCES, HR_SOURCES, type FinanceSource, type HrSource } from "../types";
import { bamboohrProvider } from "../bamboohr/provider";
import type { FinanceProvider, HrProvider, ProviderRegistry } from "./types";

export type { FinanceProvider, HrProvider, ProviderHealth, ProviderRegistry } from "./types";

export const providers: ProviderRegistry = {
  hr: {
    bamboohr: bamboohrProvider,
  },
  finance: {
    // register sage here: sage: sageProvider,
  },
};

/** The HR source named by HR_SOURCE. Defaults to bamboohr; anything unknown is an error, not a fallback. */
export function activeHrSource(): HrSource {
  const raw = (process.env.HR_SOURCE ?? "bamboohr").trim().toLowerCase();
  if (!(HR_SOURCES as readonly string[]).includes(raw)) {
    throw new Error(`HR_SOURCE="${raw}" is not one of ${HR_SOURCES.join(", ")}`);
  }
  return raw as HrSource;
}

export function activeHrProvider(): HrProvider {
  const source = activeHrSource();
  const provider = providers.hr[source];
  if (!provider) {
    throw new Error(`HR_SOURCE=${source} but no provider is registered for it. Add one in src/data/canonical/providers/index.ts.`);
  }
  return provider;
}

/**
 * The finance source named by FINANCE_SOURCE, or null when it is unset. Unset
 * means "no finance connector yet", which is the state this project ships in.
 * A value that names no registered provider is an error, not a fallback.
 */
export function activeFinanceSource(): FinanceSource | null {
  const raw = (process.env.FINANCE_SOURCE ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (!(FINANCE_SOURCES as readonly string[]).includes(raw)) {
    throw new Error(`FINANCE_SOURCE="${raw}" is not one of ${FINANCE_SOURCES.join(", ")}`);
  }
  return raw as FinanceSource;
}

export function activeFinanceProvider(): FinanceProvider | null {
  const source = activeFinanceSource();
  if (!source) return null;
  const provider = providers.finance[source];
  if (!provider) {
    throw new Error(`FINANCE_SOURCE=${source} but no provider is registered for it. Add one in src/data/canonical/providers/index.ts.`);
  }
  return provider;
}
