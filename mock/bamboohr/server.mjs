// Mock BambooHR. Mirrors the three endpoints the connector uses, with the
// real API's paths, auth and shapes. The data file is re-read on every request,
// so editing mock/bamboohr/data/employees.json is "a change made in BambooHR".
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDotEnv } from "../../scripts/env.mjs";

loadDotEnv();

const PORT = Number(process.env.MOCK_BAMBOOHR_PORT) || 4010;
const API_KEY = process.env.BAMBOOHR_API_KEY ?? "sat-bamboo-key-123";
const COMPANY = process.env.BAMBOOHR_COMPANY ?? "halden";
const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), "data", "employees.json");

// The directory endpoint lists which fields it returns, like the real one.
const DIRECTORY_FIELDS = [
  { id: "displayName", type: "text", name: "Display name" },
  { id: "firstName", type: "text", name: "First name" },
  { id: "lastName", type: "text", name: "Last name" },
  { id: "jobTitle", type: "list", name: "Job title" },
  { id: "department", type: "list", name: "Department" },
  { id: "location", type: "list", name: "Location" },
  { id: "supervisor", type: "employee", name: "Manager" },
  { id: "workEmail", type: "email", name: "Work email" },
];

function readEmployees() {
  return JSON.parse(readFileSync(DATA_FILE, "utf8")).employees;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// BambooHR uses Basic auth with the API key as the username and any password.
function authorized(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const user = decoded.slice(0, decoded.indexOf(":") === -1 ? decoded.length : decoded.indexOf(":"));
  return user === API_KEY;
}

function directoryEntry(e) {
  return {
    id: e.id,
    displayName: e.displayName,
    firstName: e.firstName,
    lastName: e.lastName,
    jobTitle: e.jobTitle,
    department: e.department,
    location: e.location,
    supervisor: e.supervisor,
    workEmail: e.workEmail,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const log = (status) => console.log(`${req.method} ${url.pathname}${url.search} -> ${status}`);

  if (!authorized(req)) {
    log(401);
    return send(res, 401, { error: "unauthorized", detail: "Basic auth with the API key as the username is required." }, {
      "WWW-Authenticate": 'Basic realm="BambooHR"',
    });
  }

  const prefix = `/api/gateway.php/${COMPANY}/v1/employees`;
  if (req.method !== "GET" || !url.pathname.startsWith(prefix)) {
    log(404);
    return send(res, 404, { error: "not_found" });
  }
  const rest = url.pathname.slice(prefix.length);
  const employees = readEmployees();

  if (rest === "/directory") {
    log(200);
    return send(res, 200, { fields: DIRECTORY_FIELDS, employees: employees.map(directoryEntry) });
  }

  if (rest === "/changed") {
    const since = url.searchParams.get("since");
    if (!since || Number.isNaN(Date.parse(since))) {
      log(400);
      return send(res, 400, { error: "bad_request", detail: "since must be an ISO 8601 timestamp" });
    }
    const changed = {};
    for (const e of employees) {
      if (Date.parse(e.lastChanged) >= Date.parse(since)) {
        changed[e.id] = { action: "Updated", lastChanged: e.lastChanged };
      }
    }
    log(200);
    return send(res, 200, { employees: changed });
  }

  const match = rest.match(/^\/(\d+)$/);
  if (match) {
    const e = employees.find((x) => x.id === match[1]);
    if (!e) {
      log(404);
      return send(res, 404, { error: "not_found" });
    }
    // ?fields=a,b,c narrows the answer. A field the record does not carry is
    // left out of the response rather than returned as null or empty.
    const fields = url.searchParams.get("fields");
    let body = e;
    if (fields) {
      body = { id: e.id };
      for (const f of fields.split(",").map((s) => s.trim())) {
        if (f in e) body[f] = e[f];
      }
    }
    log(200);
    return send(res, 200, body);
  }

  log(404);
  return send(res, 404, { error: "not_found" });
});

server.listen(PORT, () => {
  console.log(`Mock BambooHR listening on http://localhost:${PORT} (company "${COMPANY}")`);
});
