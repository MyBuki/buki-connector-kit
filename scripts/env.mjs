// Loads .env into process.env for the plain Node scripts (the mocks and the
// scheduler). Next.js loads .env on its own; these scripts run outside it.
// Values already in the environment win, so `SYNC_INTERVAL_SECONDS=30 npm run cron`
// works without editing the file.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadDotEnv(dir = process.cwd()) {
  let text;
  try {
    text = readFileSync(join(dir, ".env"), "utf8");
  } catch {
    return; // no .env yet; the defaults in each script apply
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
