/**
 * A plain-text table: headers, rows, and which columns are numbers. Text is
 * left-aligned, numbers right-aligned, two spaces between columns, no box
 * drawing. It is what a module page's <table> becomes in a terminal.
 */

import { SOURCE_LABEL, type AnySource } from "../../data/canonical/types";
import { fmtDateTime } from "../format";

export interface Column {
  header: string;
  /** Right-align, as a page does with its "num" cells. */
  num?: boolean;
}

export function table(columns: Column[], rows: string[][], indent = "  "): string {
  const widths = columns.map((c, i) => Math.max(c.header.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    indent +
    cells
      .map((cell, i) => (columns[i].num ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd();
  return [line(columns.map((c) => c.header)), ...rows.map(line)].join("\n");
}

/**
 * The citation a page prints under every figure: "Sage, synced 30 Oct 2026, 12:00 UTC".
 * The same words as the satellite's Cite component.
 */
export function cite(source: AnySource | null, syncedAt: string | null): string {
  if (!source) return "No source synced yet";
  return `${SOURCE_LABEL[source]}, synced ${fmtDateTime(syncedAt)}`;
}
