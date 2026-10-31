/**
 * The command line. Everything the satellite's pages and routes do, from a
 * terminal, against the same store and the same figures:
 *
 *   npm run health              each configured provider's health()
 *   npm run sync                one sync of every configured domain
 *   npm run cron                the same on a loop, every SYNC_INTERVAL_SECONDS
 *   npm run show -- people      the People module
 *   npm run show -- finance     the Finance module
 *   npm run ask -- "<question>" the brief
 *   npm run check -- <file>     validate a canonical finance set and show what it answers
 *
 * No web server. The sync is called directly, so there is exactly one way a
 * sync happens here too.
 */

import { readFile } from "node:fs/promises";
import { loadDotEnv } from "../scripts/env.mjs";
import { activeFinanceProvider, activeFinanceSource, activeHrProvider, activeHrSource } from "./data/canonical/providers";
import { SOURCE_LABEL, type SyncRun } from "./data/canonical/types";
import { answerBrief } from "./lib/brief/answer";
import { formatFindings, validateFinanceSet } from "./lib/check/validate";
import { fmtDateTime } from "./lib/format";
import { renderFinance, type FinanceEnv } from "./lib/show/finance";
import { renderPeople } from "./lib/show/people";
import { emptyHr, readStore, type Store } from "./lib/store/store";
import { runSync } from "./lib/sync/runSync";

loadDotEnv();

const USAGE = `Usage:
  npm run health
  npm run sync
  npm run cron
  npm run show -- people | finance
  npm run ask -- "<question>"
  npm run check -- <file.json>`;

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

function safe<T>(read: () => T): { value: T | null; error: string | null } {
  try {
    return { value: read(), error: null };
  } catch (err) {
    return { value: null, error: describe(err) };
  }
}

// ---------------------------------------------------------------------------
// sync and cron: the satellite's scripts/cron.mjs, calling runSync directly
// ---------------------------------------------------------------------------

function printRun(run: SyncRun): void {
  const label = `${run.domain}/${run.source}`;
  if (run.ok) {
    console.log(`${stamp()}  ok    ${label}: pulled ${run.pulled}, added ${run.added}, changed ${run.changed}, removed ${run.removed} (${run.durationMs} ms)`);
  } else {
    console.log(`${stamp()}  fail  ${label}: ${run.error}`);
  }
}

async function syncOnce(): Promise<boolean> {
  const report = await runSync();
  for (const run of report.runs) printRun(run);
  return report.ok;
}

async function cron(): Promise<never> {
  const intervalS = Math.max(5, Number(process.env.SYNC_INTERVAL_SECONDS) || 300);
  console.log(`Syncing every ${intervalS}s. Ctrl+C to stop.`);
  let running = false;
  const tick = async () => {
    if (running) return; // a slow source does not get a second sync on top of the first
    running = true;
    try {
      await syncOnce();
    } catch (err) {
      console.log(`${stamp()}  fail  ${describe(err)}`);
    } finally {
      running = false;
    }
  };
  await tick();
  setInterval(tick, intervalS * 1000);
  return new Promise(() => {}); // runs until Ctrl+C
}

// ---------------------------------------------------------------------------
// health: the satellite's /api/health
// ---------------------------------------------------------------------------

async function health(): Promise<boolean> {
  const store = await readStore();
  let ok = true;

  const hr = await (async () => {
    try {
      const provider = activeHrProvider();
      return { source: provider.source as string, ...(await provider.health()) };
    } catch (err) {
      return { source: safe(activeHrSource).value ?? "none", ok: false, detail: describe(err) };
    }
  })();
  ok &&= hr.ok;
  console.log(`hr       ${hr.source.padEnd(9)} ${hr.ok ? "ok  " : "fail"}  ${hr.detail}`);
  console.log(`         ${store.hr.syncedAt ? `last synced ${fmtDateTime(store.hr.syncedAt)}, ${store.hr.employees.length} records in the store` : "not synced yet"}`);

  const finance = await (async () => {
    try {
      const provider = activeFinanceProvider();
      if (!provider) return { source: "none", ok: true, configured: false, detail: "No finance source configured (FINANCE_SOURCE is unset)" };
      return { source: provider.source as string, configured: true, ...(await provider.health()) };
    } catch (err) {
      return { source: safe(activeFinanceSource).value ?? "none", ok: false, configured: true, detail: describe(err) };
    }
  })();
  ok &&= finance.ok;
  const f = store.finance;
  console.log(`finance  ${finance.source.padEnd(9)} ${finance.configured ? (finance.ok ? "ok  " : "fail") : "none"}  ${finance.detail}`);
  console.log(
    `         ${
      f.syncedAt
        ? `last synced ${fmtDateTime(f.syncedAt)}, ${f.accounts.length} accounts, ${f.parties.length} parties, ${f.invoices.length} invoices, ${f.bankTransactions.length} bank transactions in the store`
        : "not synced yet"
    }`,
  );
  return ok;
}

// ---------------------------------------------------------------------------
// show and ask: the module pages and the brief
// ---------------------------------------------------------------------------

function financeEnv(): FinanceEnv {
  const read = safe(activeFinanceSource);
  return { configuredSource: read.value, error: read.error };
}

async function show(what: string | undefined): Promise<boolean> {
  const store = await readStore();
  const now = new Date();
  if (what === "people") {
    console.log(renderPeople(store.hr, now));
    return true;
  }
  if (what === "finance") {
    console.log(renderFinance(store.finance, now, financeEnv()));
    return true;
  }
  console.error(`show: expected "people" or "finance", got ${what ? `"${what}"` : "nothing"}.\n${USAGE}`);
  return false;
}

/** The brief as the /brief page prints it: the answer, each figure, the citation. */
function renderAnswer(question: string, store: Store, now: Date): string {
  const result = answerBrief(question, store, now);
  const lines = [result.answer, ...result.figures.map((f) => `  ${f.label}: ${f.value}`)];
  lines.push(
    result.cited.source
      ? `${SOURCE_LABEL[result.cited.source]}, synced ${fmtDateTime(result.cited.syncedAt)}, ${result.cited.records} records`
      : "No source synced",
  );
  return lines.join("\n");
}

async function ask(question: string): Promise<boolean> {
  if (!question.trim()) {
    console.error(`ask: give a question in quotes.\n${USAGE}`);
    return false;
  }
  console.log(renderAnswer(question, await readStore(), new Date()));
  return true;
}

// ---------------------------------------------------------------------------
// check: validate a canonical finance set, then show what it answers
// ---------------------------------------------------------------------------

const CHECK_QUESTIONS = [
  "how much cash do we have",
  "what did we invoice last month",
  "who owes us money",
  "what did we spend on software last month",
  "biggest customers",
];

async function check(file: string | undefined): Promise<boolean> {
  if (!file) {
    console.error(`check: give the path of a JSON file holding { accounts, parties, invoices, bankTransactions }.\n${USAGE}`);
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    console.error(`${file}: ${describe(err)}`);
    return false;
  }

  const result = validateFinanceSet(parsed);
  const counts = result.set
    ? `${result.set.accounts.length} accounts, ${result.set.parties.length} parties, ${result.set.invoices.length} invoices, ${result.set.bankTransactions.length} bank transactions`
    : null;
  const tally = `${result.errors.length} ${result.errors.length === 1 ? "error" : "errors"}, ${result.warnings.length} ${result.warnings.length === 1 ? "warning" : "warnings"}`;

  if (result.errors.length || result.warnings.length) {
    console.log(`${file}: ${tally}.\n`);
    console.log(formatFindings(result));
  }
  if (!result.set) return false;

  console.log(`${file} is valid: ${counts}. ${tally}.\n`);
  console.log("Loaded into an in-memory store as if synced from Sage just now. This is what npm run show -- finance and npm run ask print once your connector produces these records.\n");

  const now = new Date();
  const store: Store = {
    hr: emptyHr(),
    finance: { source: "sage", syncedAt: now.toISOString(), ...result.set },
    runs: [],
  };
  console.log(renderFinance(store.finance, now));
  for (const q of CHECK_QUESTIONS) {
    console.log(`\nAsk: ${q}`);
    console.log(renderAnswer(q, store, now));
  }
  return true;
}

// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<boolean> {
  const [command, ...rest] = argv;
  switch (command) {
    case "health":
      return health();
    case "sync":
      return syncOnce();
    case "cron":
      return cron();
    case "show":
      return show(rest[0]);
    case "ask":
      return ask(rest.join(" "));
    case "check":
      return check(rest[0]);
    default:
      console.error(USAGE);
      return false;
  }
}

main(process.argv.slice(2)).then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(describe(err));
    process.exit(1);
  },
);
