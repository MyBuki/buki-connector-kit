/**
 * The validator behind `npm run check`: a canonical finance set in, a list of
 * findings out. Hand-written, no library, so every rule it applies is one you
 * can read here.
 *
 * It checks what the types in src/data/canonical/types.ts cannot: that an id
 * is `${source}:${sourceId}`, that a date is a date, that a currency is a
 * currency, that an invoice does not owe more than its total, and that the
 * records point at each other. Dangling references are WARNINGS, because a
 * connector that pulls invoices before it pulls parties will have them for a
 * while and the figures still compute ("customer not on file").
 *
 * The one ERROR that is the kit's own rule: an optional field that is present
 * must carry a real value. `null`, "" and the string "undefined" are what a
 * defaulted field looks like on the wire, and a defaulted field is exactly what
 * the brief cannot see through. Leave it absent, never default it.
 */

import type { BankTransaction, Invoice, LedgerAccount, Party } from "../../data/canonical/types";

export interface Finding {
  level: "error" | "warning";
  /** Which top-level array the record is in: accounts, parties, invoices, bankTransactions. */
  collection: string;
  /** The record's id, or "#<index>" when it has none. */
  id: string;
  field: string;
  message: string;
}

export interface FinanceSet {
  accounts: LedgerAccount[];
  parties: Party[];
  invoices: Invoice[];
  bankTransactions: BankTransaction[];
}

export interface CheckResult {
  errors: Finding[];
  warnings: Finding[];
  /** The set as typed records. Present only when there are no errors. */
  set: FinanceSet | null;
}

export const ABSENT_RULE = "leave it absent, never default it";

const COLLECTIONS = ["accounts", "parties", "invoices", "bankTransactions"] as const;

// ---------------------------------------------------------------------------
// field checks: a value in, a problem out (or null when it is fine)
// ---------------------------------------------------------------------------

type Check = (v: unknown) => string | null;

const str: Check = (v) => (typeof v === "string" && v.trim() !== "" ? null : `must be a non-empty string, found ${show(v)}`);

const num: Check = (v) => (typeof v === "number" && Number.isFinite(v) ? null : `must be a number, found ${show(v)}`);

const date: Check = (v) => {
  if (typeof v !== "string") return `must be a date as YYYY-MM-DD, found ${show(v)}`;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return `must be a date as YYYY-MM-DD, found ${show(v)}`;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v ? null : `is not a real date: ${show(v)}`;
};

const currency: Check = (v) =>
  typeof v === "string" && /^[A-Z]{3}$/.test(v) ? null : `must be a three-letter upper-case ISO 4217 code such as "USD", found ${show(v)}`;

const oneOf =
  (allowed: readonly string[]): Check =>
  (v) =>
    typeof v === "string" && allowed.includes(v) ? null : `must be one of ${allowed.map((a) => `"${a}"`).join(", ")}, found ${show(v)}`;

const arr: Check = (v) => (Array.isArray(v) ? null : `must be an array, found ${show(v)}`);

interface FieldSpec {
  required: boolean;
  check: Check;
}

const req = (check: Check): FieldSpec => ({ required: true, check });
const opt = (check: Check): FieldSpec => ({ required: false, check });

const common = {
  id: req(str),
  source: req(oneOf(["sage"])),
  sourceId: req(str),
  sourceUpdatedAt: opt(str),
};

const SPECS: Record<(typeof COLLECTIONS)[number], Record<string, FieldSpec>> = {
  accounts: {
    ...common,
    code: opt(str),
    name: req(str),
    type: req(oneOf(["asset", "liability", "equity", "income", "expense"])),
  },
  parties: {
    ...common,
    name: req(str),
    kind: req(oneOf(["customer", "supplier", "both"])),
    email: opt(str),
  },
  invoices: {
    ...common,
    kind: req(oneOf(["sales", "purchase"])),
    partyId: req(str),
    number: opt(str),
    date: req(date),
    dueDate: opt(date),
    status: req(oneOf(["draft", "unpaid", "part_paid", "paid", "void"])),
    currency: req(currency),
    total: req(num),
    outstanding: req(num),
    lines: req(arr),
  },
  bankTransactions: {
    ...common,
    bankAccountId: req(str),
    date: req(date),
    amount: req(num),
    currency: req(currency),
    description: req(str),
    accountId: opt(str),
    partyId: opt(str),
  },
};

const LINE_SPEC: Record<string, FieldSpec> = {
  description: req(str),
  accountId: req(str),
  net: req(num),
};

/** What a defaulted field looks like once it has been through JSON. */
function looksDefaulted(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || v === "undefined" || v === "null"));
}

function show(v: unknown): string {
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
  if (Array.isArray(v)) return "an array";
  return "an object";
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// the validator
// ---------------------------------------------------------------------------

export function validateFinanceSet(input: unknown): CheckResult {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const error = (collection: string, id: string, field: string, message: string) => errors.push({ level: "error", collection, id, field, message });
  const warn = (collection: string, id: string, field: string, message: string) => warnings.push({ level: "warning", collection, id, field, message });

  if (!isObject(input)) {
    error("(file)", "", "", `the file must be a JSON object with ${COLLECTIONS.join(", ")}, found ${show(input)}`);
    return { errors, warnings, set: null };
  }
  for (const key of Object.keys(input)) {
    if (!(COLLECTIONS as readonly string[]).includes(key)) warn("(file)", "", key, "is not one of the four canonical collections and is ignored");
  }

  const ids = new Map<string, Set<string>>();
  for (const collection of COLLECTIONS) {
    const records = input[collection];
    const seen = new Set<string>();
    ids.set(collection, seen);
    if (!Array.isArray(records)) {
      error(collection, "", "", `must be an array (an empty one is fine), found ${show(records)}`);
      continue;
    }
    records.forEach((record: unknown, index: number) => {
      if (!isObject(record)) {
        error(collection, `#${index}`, "", `record is not an object, found ${show(record)}`);
        return;
      }
      const id = typeof record.id === "string" && record.id ? record.id : `#${index}`;
      checkFields(collection, id, record, SPECS[collection], error, warn);

      if (typeof record.source === "string" && typeof record.sourceId === "string" && typeof record.id === "string") {
        const expected = `${record.source}:${record.sourceId}`;
        if (record.id !== expected) error(collection, id, "id", `must be "${expected}" (source, a colon, sourceId), found ${show(record.id)}`);
      }
      if (typeof record.id === "string" && record.id) {
        if (seen.has(record.id)) error(collection, id, "id", "is used by more than one record in this collection");
        seen.add(record.id);
      }

      if (collection === "invoices") checkInvoice(id, record, error, warn);
    });
  }

  // Referential integrity. Only once every record has been looked at, since a
  // reference can point forward.
  const accountIds = ids.get("accounts")!;
  const partyIds = ids.get("parties")!;
  const accountsByType = new Map<string, string>();
  if (Array.isArray(input.accounts)) {
    for (const a of input.accounts as unknown[]) {
      if (isObject(a) && typeof a.id === "string" && typeof a.type === "string") accountsByType.set(a.id, `${a.type}`);
    }
  }
  if (Array.isArray(input.invoices)) {
    (input.invoices as unknown[]).forEach((inv, index) => {
      if (!isObject(inv)) return;
      const id = typeof inv.id === "string" && inv.id ? inv.id : `#${index}`;
      if (typeof inv.partyId === "string" && inv.partyId && !partyIds.has(inv.partyId)) {
        warn("invoices", id, "partyId", `${show(inv.partyId)} is not in parties; the brief will say "customer not on file"`);
      }
      if (Array.isArray(inv.lines)) {
        inv.lines.forEach((line: unknown, i: number) => {
          if (isObject(line) && typeof line.accountId === "string" && line.accountId && !accountIds.has(line.accountId)) {
            warn("invoices", id, `lines[${i}].accountId`, `${show(line.accountId)} is not in accounts; the spend table will say "account not on file"`);
          }
        });
      }
    });
  }
  if (Array.isArray(input.bankTransactions)) {
    (input.bankTransactions as unknown[]).forEach((t, index) => {
      if (!isObject(t)) return;
      const id = typeof t.id === "string" && t.id ? t.id : `#${index}`;
      if (typeof t.bankAccountId === "string" && t.bankAccountId) {
        if (!accountIds.has(t.bankAccountId)) {
          warn("bankTransactions", id, "bankAccountId", `${show(t.bankAccountId)} is not in accounts; cash will be shown under the id instead of a name`);
        } else if (accountsByType.get(t.bankAccountId) !== "asset") {
          warn("bankTransactions", id, "bankAccountId", `points at an account of type "${accountsByType.get(t.bankAccountId)}"; a bank account is an asset`);
        }
      }
      if (typeof t.accountId === "string" && t.accountId && !accountIds.has(t.accountId)) {
        warn("bankTransactions", id, "accountId", `${show(t.accountId)} is not in accounts`);
      }
      if (typeof t.partyId === "string" && t.partyId && !partyIds.has(t.partyId)) {
        warn("bankTransactions", id, "partyId", `${show(t.partyId)} is not in parties`);
      }
    });
  }

  if (errors.length) return { errors, warnings, set: null };
  return {
    errors,
    warnings,
    set: {
      accounts: input.accounts as LedgerAccount[],
      parties: input.parties as Party[],
      invoices: input.invoices as Invoice[],
      bankTransactions: input.bankTransactions as BankTransaction[],
    },
  };
}

type Report = (collection: string, id: string, field: string, message: string) => void;

function checkFields(collection: string, id: string, record: Record<string, unknown>, spec: Record<string, FieldSpec>, error: Report, warn: Report): void {
  for (const [field, rule] of Object.entries(spec)) {
    if (!(field in record)) {
      if (rule.required) error(collection, id, field, "required field is missing");
      continue;
    }
    const value = record[field];
    if (looksDefaulted(value)) {
      error(
        collection,
        id,
        field,
        rule.required
          ? `required field is ${show(value)}; a record the source cannot describe is left out, not written with a blank`
          : `${ABSENT_RULE} (found ${show(value)})`,
      );
      continue;
    }
    const problem = rule.check(value);
    if (problem) error(collection, id, field, problem);
  }
  for (const field of Object.keys(record)) {
    if (!(field in spec)) warn(collection, id, field, "is not a canonical field; nothing in Buki reads it");
  }
}

function checkInvoice(id: string, inv: Record<string, unknown>, error: Report, warn: Report): void {
  if (Array.isArray(inv.lines)) {
    inv.lines.forEach((line: unknown, i: number) => {
      if (!isObject(line)) {
        error("invoices", id, `lines[${i}]`, `must be an object with description, accountId and net, found ${show(line)}`);
        return;
      }
      for (const [field, rule] of Object.entries(LINE_SPEC)) {
        const key = `lines[${i}].${field}`;
        if (!(field in line)) {
          error("invoices", id, key, "required field is missing");
          continue;
        }
        if (looksDefaulted(line[field])) {
          error("invoices", id, key, `required field is ${show(line[field])}`);
          continue;
        }
        const problem = rule.check(line[field]);
        if (problem) error("invoices", id, key, problem);
      }
      for (const field of Object.keys(line)) {
        if (!(field in LINE_SPEC)) warn("invoices", id, `lines[${i}].${field}`, "is not a canonical field; nothing in Buki reads it");
      }
    });
  }
  const total = inv.total;
  const outstanding = inv.outstanding;
  if (typeof total === "number" && typeof outstanding === "number") {
    if (outstanding > total) error("invoices", id, "outstanding", `is ${outstanding}, more than the total of ${total}`);
    if (inv.status === "paid" && outstanding !== 0) error("invoices", id, "outstanding", `status is "paid" but outstanding is ${outstanding}, not 0`);
  }
}

/** The findings as the terminal shows them: a numbered list per level. */
export function formatFindings(result: CheckResult): string {
  const lines: string[] = [];
  const block = (title: string, findings: Finding[]) => {
    if (!findings.length) return;
    lines.push(title);
    findings.forEach((f, i) => {
      const where = [f.collection, f.id, f.field].filter(Boolean).join(" ");
      lines.push(`  ${String(i + 1).padStart(String(findings.length).length)}. ${where}: ${f.message}`);
    });
    lines.push("");
  };
  block("Errors", result.errors);
  block("Warnings", result.warnings);
  return lines.join("\n");
}
