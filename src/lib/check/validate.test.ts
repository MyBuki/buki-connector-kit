import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABSENT_RULE, formatFindings, validateFinanceSet } from "./validate";

const SAMPLE_PATH = new URL("../../../sample/finance.sample.json", import.meta.url);

/** A fresh copy of the sample each time, so a test can break one record without touching the others. */
const sample = () => JSON.parse(readFileSync(SAMPLE_PATH, "utf8"));

describe("validateFinanceSet", () => {
  it("passes the sample with no errors and no warnings", () => {
    const result = validateFinanceSet(sample());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.set?.invoices).toHaveLength(8);
  });

  it("rejects an optional field that is present but empty, with the kit's one rule", () => {
    const set = sample();
    set.invoices[0].dueDate = null;
    set.parties[0].email = "";
    set.accounts[0].code = "undefined";
    const { errors, set: typed } = validateFinanceSet(set);
    expect(typed).toBeNull();
    expect(errors.map((e) => `${e.id} ${e.field}`)).toEqual(["sage:acc-1200 code", "sage:con-2001 email", "sage:si-3001 dueDate"]);
    for (const e of errors) expect(e.message).toContain(ABSENT_RULE);
  });

  it("rejects an id that is not source, a colon, sourceId, and a source that is not sage", () => {
    const set = sample();
    set.accounts[0].id = "acc-1200";
    set.parties[0].source = "xero";
    const { errors } = validateFinanceSet(set);
    expect(errors.find((e) => e.id === "acc-1200" && e.field === "id")?.message).toContain('must be "sage:acc-1200"');
    expect(errors.find((e) => e.id === "sage:con-2001" && e.field === "source")?.message).toContain('"sage"');
  });

  it("rejects outstanding above total, and a paid invoice that still owes", () => {
    const set = sample();
    set.invoices[1].outstanding = 9501; // total 9500
    set.invoices[0].outstanding = 10; // status paid
    const { errors } = validateFinanceSet(set);
    expect(errors.map((e) => `${e.id}: ${e.message}`)).toEqual([
      "sage:si-3001: status is \"paid\" but outstanding is 10, not 0",
      "sage:si-3002: is 9501, more than the total of 9500",
    ]);
  });

  it("warns, not errors, on a reference to a party or account that is not in the set", () => {
    const set = sample();
    set.invoices[1].partyId = "sage:con-9999";
    set.bankTransactions[0].partyId = "sage:con-9999";
    set.invoices[6].lines[0].accountId = "sage:acc-9999";
    const result = validateFinanceSet(set);
    expect(result.errors).toEqual([]);
    expect(result.set).not.toBeNull();
    expect(result.warnings.map((w) => `${w.collection} ${w.id} ${w.field}`)).toEqual([
      "invoices sage:si-3002 partyId",
      "invoices sage:pi-3101 lines[0].accountId",
      "bankTransactions sage:bt-5001 partyId",
    ]);
  });

  it("checks required fields, enums, dates, currencies and shapes", () => {
    const set = sample();
    delete set.invoices[0].date;
    set.invoices[1].status = "open";
    set.invoices[2].date = "2026-02-30";
    set.invoices[3].currency = "usd";
    set.invoices[4].total = "4000";
    set.invoices[5].lines = "none";
    set.bankTransactions[0].amount = null;
    set.accounts[0].type = "bank";
    const { errors } = validateFinanceSet(set);
    expect(errors.map((e) => `${e.id} ${e.field}`)).toEqual([
      "sage:acc-1200 type",
      "sage:si-3001 date",
      "sage:si-3002 status",
      "sage:si-3003 date",
      "sage:si-3004 currency",
      "sage:si-3005 total",
      "sage:si-3006 lines",
      "sage:bt-5001 amount",
    ]);
  });

  it("refuses a file that is not the four collections", () => {
    expect(validateFinanceSet([]).errors[0].message).toContain("must be a JSON object");
    const { errors, warnings } = validateFinanceSet({ accounts: [], parties: [], invoices: {}, employees: [] });
    expect(errors.map((e) => `${e.collection}: ${e.message}`)).toEqual([
      "invoices: must be an array (an empty one is fine), found an object",
      "bankTransactions: must be an array (an empty one is fine), found undefined",
    ]);
    expect(warnings[0].field).toBe("employees");
  });

  it("prints findings as a numbered list with the record id and field", () => {
    const set = sample();
    set.invoices[0].dueDate = null;
    set.invoices[1].partyId = "sage:con-9999";
    const text = formatFindings(validateFinanceSet(set));
    expect(text).toContain("Errors\n  1. invoices sage:si-3001 dueDate: leave it absent, never default it (found null)");
    expect(text).toContain("Warnings\n  1. invoices sage:si-3002 partyId: \"sage:con-9999\" is not in parties");
  });
});
