/**
 * The BambooHR provider: the one object the registry hands to the rest of the
 * app. It wires client + normalize and nothing more.
 */

import type { HrProvider } from "../providers/types";
import { BambooHrClient, BambooHrError, configFromEnv, describe } from "./client";
import { normalizeEmployees } from "./normalize";

export const bamboohrProvider: HrProvider = {
  source: "bamboohr",

  async health() {
    try {
      const config = configFromEnv();
      const directory = await new BambooHrClient(config).directory();
      return { ok: true, detail: `${directory.employees.length} people in the "${config.company}" directory at ${config.baseUrl}` };
    } catch (err) {
      const kind = err instanceof BambooHrError ? err.kind : "unknown";
      return { ok: false, detail: `${kind}: ${describe(err)}` };
    }
  },

  async employees() {
    const client = new BambooHrClient(configFromEnv());
    const directory = await client.directory();
    const details = await client.employees(directory.employees.map((e) => e.id));
    return normalizeEmployees(directory.employees, details);
  },
};
