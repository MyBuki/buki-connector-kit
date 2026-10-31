import { describe, expect, it } from "vitest";
import type { Employee } from "../../data/canonical/types";
import { diffRecords } from "./runSync";

const person = (sourceId: string, over: Partial<Employee> = {}): Employee => ({
  id: `bamboohr:${sourceId}`,
  source: "bamboohr",
  sourceId,
  displayName: `Person ${sourceId}`,
  title: "Engineer",
  department: "Engineering",
  location: "Denver, CO",
  managerId: null,
  hireDate: "2024-01-01",
  terminationDate: null,
  status: "active",
  ...over,
});

describe("diffRecords", () => {
  it("reports added, changed and removed by canonical id", () => {
    const before = [person("1"), person("2", { title: "Engineer" }), person("3")];
    const after = [person("1"), person("2", { title: "Senior Engineer" }), person("4")];
    expect(diffRecords(before, after)).toEqual({
      added: ["bamboohr:4"],
      changed: ["bamboohr:2"],
      removed: ["bamboohr:3"],
    });
  });

  it("does not count key order or an undefined field as a change", () => {
    const a = person("1", { annualSalary: 100000, currency: "USD" });
    const b = { ...person("1"), currency: "USD", annualSalary: 100000, workEmail: undefined } as Employee;
    expect(diffRecords([a], [b]).changed).toEqual([]);
  });
});
