/**
 * The BambooHR HTTP client. Knows the base URL, the company, Basic auth and
 * timeouts. Returns raw API shapes and nothing else; mapping to canonical lives
 * in normalize.ts so a wire change and a meaning change never hide in one file.
 */

import {
  BAMBOO_DETAIL_FIELDS,
  type BambooChangedResponse,
  type BambooDirectoryResponse,
  type BambooEmployeeDetail,
} from "./raw/types";

export type BambooErrorKind = "config" | "auth" | "http" | "network" | "timeout" | "shape";

export class BambooHrError extends Error {
  constructor(
    public readonly kind: BambooErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BambooHrError";
  }
}

export interface BambooConfig {
  baseUrl: string;
  company: string;
  apiKey: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
/** How many detail requests run at once. The real API rate limits; the mock does not, but the habit matters. */
const DETAIL_CONCURRENCY = 4;

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BambooConfig {
  const baseUrl = env.BAMBOOHR_BASE_URL;
  const company = env.BAMBOOHR_COMPANY;
  const apiKey = env.BAMBOOHR_API_KEY;
  if (!baseUrl || !company || !apiKey) {
    throw new BambooHrError("config", "BAMBOOHR_BASE_URL, BAMBOOHR_COMPANY and BAMBOOHR_API_KEY must all be set");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), company, apiKey };
}

export class BambooHrClient {
  constructor(private readonly config: BambooConfig) {}

  private url(path: string, query?: Record<string, string>): string {
    const u = new URL(`${this.config.baseUrl}/api/gateway.php/${this.config.company}/v1/employees${path}`);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }

  private async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    // BambooHR Basic auth: the API key is the username, the password is anything.
    const basic = Buffer.from(`${this.config.apiKey}:x`).toString("base64");
    let res: Response;
    try {
      res = await fetch(this.url(path, query), {
        headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new BambooHrError("timeout", `BambooHR did not answer ${path} within ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw new BambooHrError("network", `Could not reach BambooHR at ${this.config.baseUrl}: ${describe(err)}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new BambooHrError("auth", "BambooHR rejected the API key", res.status);
    }
    if (!res.ok) {
      throw new BambooHrError("http", `BambooHR answered ${path} with HTTP ${res.status}`, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new BambooHrError("shape", `BambooHR answered ${path} with something that is not JSON`);
    }
  }

  async directory(): Promise<BambooDirectoryResponse> {
    const body = await this.get<BambooDirectoryResponse>("/directory");
    if (!Array.isArray(body?.employees)) {
      throw new BambooHrError("shape", "The directory response has no employees array");
    }
    return body;
  }

  async employee(id: string): Promise<BambooEmployeeDetail> {
    const body = await this.get<BambooEmployeeDetail>(`/${id}`, { fields: BAMBOO_DETAIL_FIELDS.join(",") });
    if (typeof body?.hireDate !== "string" || typeof body?.status !== "string") {
      throw new BambooHrError("shape", `Employee ${id} came back without hireDate or status`);
    }
    return body;
  }

  /** Ids changed since a timestamp. Not used by the full sync; here because an incremental one would start from it. */
  async changedSince(sinceIso: string): Promise<BambooChangedResponse> {
    return this.get<BambooChangedResponse>("/changed", { since: sinceIso });
  }

  /** Detail for many ids, a few at a time. The first failure stops the pull; a partial roster is not a roster. */
  async employees(ids: string[]): Promise<Map<string, BambooEmployeeDetail>> {
    const out = new Map<string, BambooEmployeeDetail>();
    for (let i = 0; i < ids.length; i += DETAIL_CONCURRENCY) {
      const batch = ids.slice(i, i + DETAIL_CONCURRENCY);
      const details = await Promise.all(batch.map((id) => this.employee(id)));
      details.forEach((d, j) => out.set(batch[j], d));
    }
    return out;
  }
}

export function describe(err: unknown): string {
  if (err instanceof Error) return err.cause instanceof Error ? `${err.message} (${err.cause.message})` : err.message;
  return String(err);
}
