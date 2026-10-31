/**
 * BambooHR API shapes, the subset the connector reads. They mirror
 * /v1/employees/directory and /v1/employees/{id} so the client can pass the
 * response through untouched and the normalizer is the only place that knows
 * both shapes.
 *
 * The rule that matters, stated once here and enforced by the types: a field
 * the source cannot supply is ABSENT on the raw record, and it stays absent
 * through normalize(). It is never defaulted. BambooHR carries no pay record
 * for a contractor, so `payRate` and `payType` are optional, and a contractor's
 * canonical `annualSalary` is simply not there.
 */

/** One row of GET /employees/directory. */
export interface BambooDirectoryEntry {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  location: string;
  /** The manager's display name. The id is on the detail record. */
  supervisor: string;
  workEmail?: string;
}

export interface BambooDirectoryResponse {
  fields: { id: string; type: string; name: string }[];
  employees: BambooDirectoryEntry[];
}

/** GET /employees/{id}?fields=... returns a flat object with the fields asked for. */
export interface BambooEmployeeDetail {
  id: string;
  hireDate: string; // YYYY-MM-DD
  terminationDate: string | null;
  status: "Active" | "Inactive";
  supervisorEId: string | null;
  /** "95000.00 USD" for Salary, "29.00 USD" for Hourly. Absent when BambooHR has no pay record. */
  payRate?: string;
  payType?: "Salary" | "Hourly";
  employmentHistoryStatus?: "Full-Time" | "Part-Time" | "Contractor";
  /** ISO timestamp of the last edit to this person. */
  lastChanged?: string;
}

/** The detail fields the connector asks for, in the order BambooHR expects them. */
export const BAMBOO_DETAIL_FIELDS = [
  "hireDate",
  "terminationDate",
  "status",
  "supervisorEId",
  "payRate",
  "payType",
  "employmentHistoryStatus",
  "lastChanged",
] as const;

/** GET /employees/changed?since=ISO */
export interface BambooChangedResponse {
  employees: Record<string, { action: "Inserted" | "Updated" | "Deleted"; lastChanged: string }>;
}
