# Buki connector kit

Buki answers questions about a company (briefs) and shows its data in modules. Every module reads one set of canonical records; every source gets there through a connector. This kit is the contract, a worked connector, a sample, and a command line that answers from whatever you connect.

It is for the **Bring Sage into Buki** evaluation. It is not the product and it is not production code. The sample company, **Halden Labs**, is made up, and nothing in this repository is real company data.

## Quick start

You need **Node 22**. Then:

```
npm install
cp .env.example .env
npm run mock                       # terminal 1: the mock BambooHR on http://localhost:4010
npm run sync                       # terminal 2: one sync of every configured source
npm run ask -- "how many people"
npm run show -- people
```

Every command:

| Command | What it does |
| --- | --- |
| `npm run mock` | The mock BambooHR on port 4010 |
| `npm run health` | Each configured provider's `health()` and what the store last synced |
| `npm run sync` | One sync of every configured domain, one line per run, exit 1 if a run failed |
| `npm run cron` | The same on a loop, every `SYNC_INTERVAL_SECONDS` (300 by default, 5 at least) |
| `npm run show -- people` | The People module, as text |
| `npm run show -- finance` | The Finance module, as text |
| `npm run ask -- "<question>"` | The brief: an answer, its figures, and what it cites |
| `npm run check -- <file.json>` | Validate a canonical finance set, then show what it answers |
| `npm test`, `npm run typecheck` | vitest and tsc |

### 60-second smoke test

With the mock BambooHR as the source, ask these. The sample data is fixed but the calendar is not: these are the answers in **October 2026**. Asked in November, "last month" is October (three names) and "this month" is November (two).

| Ask | Expect |
| --- | --- |
| `npm run ask -- "How many people?"` | **43** people on the payroll, 2 more with a start date after today |
| `npm run ask -- "Who joined last month?"` | **3** names for September 2026: Arjun Desai, Camila Santos, Nathan Osei |
| `npm run ask -- "What does the Engineering team cost?"` | **$2,228,000** a year across 14 people, and "1 of 15 have no salary on file, so this is a floor" |
| `npm run ask -- "Who reports to Marcus Whitfield?"` | **6** names |
| `npm run ask -- "How much cash do we have?"` | "No finance source connected yet." That is the gap you are closing. |

Every answer ends with the source it came from and when it was synced. `npm run show -- people` prints the same figures as a module: headcount, who joined and left, cost by department, the roster. `npm run health` says what is connected.

## How a module expects its data

Everything downstream of a connector reads the canonical shapes in `src/data/canonical/types.ts` and nothing else. The finance side has four record types. Here they are as TypeScript, then in words.

```ts
export interface LedgerAccount {
  id: string; // `${source}:${sourceId}`
  source: FinanceSource;
  sourceId: string;
  code?: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  sourceUpdatedAt?: string;
}

export interface Party {
  id: string;
  source: FinanceSource;
  sourceId: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  email?: string;
  sourceUpdatedAt?: string;
}

export interface InvoiceLine {
  description: string;
  accountId: string; // canonical LedgerAccount id
  net: number;
}

export interface Invoice {
  id: string;
  source: FinanceSource;
  sourceId: string;
  kind: "sales" | "purchase";
  partyId: string; // canonical Party id
  number?: string;
  date: string; // YYYY-MM-DD
  dueDate?: string;
  status: "draft" | "unpaid" | "part_paid" | "paid" | "void";
  currency: string; // ISO 4217
  total: number;
  outstanding: number;
  lines: InvoiceLine[];
  sourceUpdatedAt?: string;
}

export interface BankTransaction {
  id: string;
  source: FinanceSource;
  sourceId: string;
  bankAccountId: string; // canonical LedgerAccount id of the bank account
  date: string; // YYYY-MM-DD
  amount: number; // signed: money in is positive, money out is negative
  currency: string;
  description: string;
  accountId?: string; // the ledger account it was posted against, when known
  partyId?: string;
  sourceUpdatedAt?: string;
}
```

**LedgerAccount** is one line of the chart of accounts, bank accounts included. `type` is one of five words. `code` is the account's number in the source when it has one. The Finance module names a bank account by its `name`, and the brief finds an expense account by its `name` ("what did we spend on *software* last month" matches "Software subscriptions").

**Party** is a customer or a supplier, or both. `email` is there when the source has one.

**Invoice** is a sales or purchase invoice. `partyId` is the canonical id of the customer or supplier. `date` is the invoice date and decides which month it was invoiced in. `dueDate` decides whether an open invoice is overdue. `status` is one of five words; `draft` and `void` invoices are left out of every figure. `total` is what the invoice is for and `outstanding` is what is still owed, both in `currency`. `lines` is the list of lines, each with the net amount and the ledger account it was posted to; the spend table and "what did we spend on" read these.

**BankTransaction** is one movement on a bank account. `bankAccountId` names the bank account, `amount` is signed (money in positive, money out negative), and cash per account is the sum of these. `accountId` and `partyId` are there when the source says what the money was for or who it went to.

**The id rule.** Every record's `id` is `${source}:${sourceId}`: the source name, a colon, the record's id in the source. `sage:si-3001`. Every reference (`partyId`, `accountId`, `bankAccountId`) is such an id. The source prefix is what lets two sources live in one store without colliding.

**Money rules.** Every amount is in the record's `currency` and is never converted. Figures are kept per currency, so a company with USD and EUR invoices gets two numbers and the words "more than one currency on file, not converted", never one made-up total. Bank amounts are signed. Negative amounts print in parentheses, `($1,200)`, the way a ledger shows them.

**The one rule, and the thing we look at first in a connector: a field the source cannot supply is left absent, never defaulted.** BambooHR carries no pay record for a contractor, so the contractor's canonical record has no `annualSalary` at all. The People module then shows "not on file", and the brief says "1 of 15 have no salary on file, so this is a floor". A defaulted 0 would have made the team cost a wrong number that reads as fact. The finance side is the same: an invoice Sage holds no due date for has no `dueDate`. It is then neither overdue nor current, and "who owes us money" says "1 open invoice has no due date on file and is not counted". A defaulted due date would have put it on one side or the other, and the brief could not tell. `null`, `""` and `"undefined"` are defaults too. `npm run check` reports each one as an error.

### The sample

`sample/finance.sample.json` is Halden Labs' books as a Sage connector would hand them to Buki: 9 accounts, 5 parties, 8 invoices, 10 bank transactions, every optional field either there or absent. `sample/README.md` says what each record is there to show. Run it through the validator and the brief:

```
npm run check -- sample/finance.sample.json
```

It passes with zero errors and zero warnings, then prints the Finance module and the five finance answers as if the file had just been synced from Sage. These are the figures in **October 2026**. Asked in November, "last month" is October: $12,000 invoiced across 1 sales invoice, and $2,350 spent on Software subscriptions from 2 lines. Cash, overdue and the customer ranking do not change.

| Ask | Answer in October 2026 |
| --- | --- |
| How much cash do we have? | **$253,615** across 2 bank accounts: Operating account $63,520, Reserve account $190,095 |
| What did we invoice last month? | **$33,500** in September 2026 across 3 sales invoices, void and draft left out |
| Who owes us money? | **2** invoices overdue, **$12,000** outstanding: Pinecrest Health $9,500 due 15 Oct 2026; Tolliver & Reed LLP $2,500 due 22 Oct 2026. 1 open invoice has no due date on file and is not counted |
| What did we spend on software last month? | **$300** on Software subscriptions in September 2026, from 1 purchase invoice line |
| Biggest customers? | 1. Northgate Analytics **$30,000**; 2. Pinecrest Health $9,500; 3. Tolliver & Reed LLP $6,000 |

Point `npm run check` at your own file to see what your connector's output will answer before it exists. The validator checks the required fields and their types, the id rule, the enums, dates, currencies, that `outstanding` never exceeds `total` and that a paid invoice owes nothing, and that every reference points at a record in the set. Dangling references are warnings (the figures still compute, and say "not on file"). Empty optional fields are errors.

## The connector contract

A connector is one object, a **provider**, that the registry hands to the rest of the kit. For finance it is this interface, in `src/data/canonical/providers/types.ts`:

```ts
export interface FinanceProvider {
  source: FinanceSource;
  health(): Promise<ProviderHealth>;
  /** The chart of accounts, including the bank accounts. */
  accounts(): Promise<LedgerAccount[]>;
  /** Customers and suppliers. */
  parties(): Promise<Party[]>;
  /**
   * Sales and purchase invoices. `since` is an ISO timestamp: when given, the
   * provider may return only records changed since then; when omitted it
   * returns everything. runSync passes nothing today and takes the full set.
   */
  invoices(since?: string): Promise<Invoice[]>;
  bankTransactions(since?: string): Promise<BankTransaction[]>;
}
```

`health()` is a cheap read that says whether the source can be reached with the configured credentials, as one plain sentence. The four record methods return canonical records, fields the source cannot supply absent. They may throw; the sync catches.

**The registry**, `src/data/canonical/providers/index.ts`, holds one provider per source per domain. `FINANCE_SOURCE` in `.env` names the finance source. Unset means "no finance connector yet", which is how the kit ships. A value that names no registered provider is an error, not a fallback. The slot for Sage is marked `register sage here`.

**The sync**, `src/lib/sync/runSync.ts`, is the one way records reach the store. For each domain with a source it pulls from the provider, diffs against the store by id, writes the new records, and records a run (pulled, added, changed, removed, how long, or the error). All four finance pulls happen before anything is written, so a failure halfway leaves the store as it was. It never throws to its caller: a failed pull is a run with `ok: false`, and the previous records stay in place, because stale data with a visible failure beats empty data with no explanation. `npm run sync` runs it once; `npm run cron` runs it on a timer.

**The store**, `src/lib/store/store.ts`, is one JSON file at `.data/store.json`. Open it after a sync and you see exactly what the modules and the brief read. Nothing reads a source API at request time.

Read the BambooHR files in this order. Each is short and its header comment says why it exists.

1. `src/data/canonical/types.ts`: the **canonical shapes**. Everything downstream reads only these.
2. `src/data/canonical/bamboohr/raw/types.ts`: BambooHR's shapes, exactly as its API returns them.
3. `src/data/canonical/bamboohr/client.ts`: HTTP only. Auth, timeouts, typed errors. Returns raw shapes and nothing else.
4. `src/data/canonical/bamboohr/normalize.ts`: raw to canonical. Pure, no I/O, the only file that knows both shapes.
5. `src/data/canonical/bamboohr/provider.ts`: the **provider** object: `health()` and `employees()`.
6. `src/data/canonical/providers/types.ts` and `index.ts`: the provider seam and the **registry**, keyed by `HR_SOURCE` and `FINANCE_SOURCE`.
7. `src/lib/sync/runSync.ts`: pull, diff against the store, write, record a run. One run per domain, never throws.
8. `src/lib/store/store.ts`: the **store**, one JSON file at `.data/store.json`.
9. `src/lib/people/figures.ts` and `src/lib/finance/figures.ts`: the figures, computed once and read by both the modules and the brief, so a module and an answer can never disagree.
10. `src/lib/show/people.ts`, `src/lib/show/finance.ts` and `src/lib/brief/answer.ts`: the **People module**, the **Finance module** and the **brief**.
11. `src/cli.ts`: the **schedule** (`npm run cron` calls `runSync` on a timer) and every other command.

### The mock BambooHR

`npm run mock` serves BambooHR's three endpoints on port 4010 with the real paths and shapes: `GET /api/gateway.php/halden/v1/employees/directory`, `GET .../employees/{id}?fields=...` and `GET .../employees/changed?since=...`. Basic auth, with the API key as the username. It re-reads `mock/bamboohr/data/employees.json` on every request, so editing that file is "a change made in BambooHR": change a title, bump that record's `lastChanged`, and the next sync reports `changed: 1`.

## The task

> **THE PROBLEM**
>
> Buki answers questions about a company (we call these "briefs") and shows its data in modules people check every week. Today it can read BambooHR for people data. Many growing companies keep their books in Sage, and that data never reaches Buki. So a brief cannot answer "who owes us money" or "what did we spend on software last month", and the Finance module stays empty.
>
> Sage is a real accounting system: OAuth sign-in, paginated endpoints, rate limits, tax rates and currencies, and records that change after you first read them.
>
> **YOUR JOB**
>
> Make Sage's data show up in Buki, in briefs and in the Finance module, and stay current without anyone pressing a button. You decide what to pull, how it maps onto Buki, and how it stays in sync. Ask us anything along the way. Your questions count as part of the work.
>
> **LOOKING FOR**
>
> 1. Your Sage connector in a private repository of your own, cloned from this kit, where `npm run ask -- "who owes us money"` and `npm run ask -- "what did we spend on software last month"` answer from your Sage trial business and `npm run show -- finance` prints the figures.
> 2. It runs on a schedule by itself. Show it picking up a change made in Sage after the first sync.
> 3. A short video (5 minutes max) of 1 and 2 working, from a fresh start.
> 4. A note (one page max): what you pulled and what you left out, and why; what happens when Sage is slow, down, or returns something unexpected; what you would still worry about.
>
> Shortlisted candidates get the Buki satellite, the private copy of the product, before their interview. Their connector goes in unchanged: same contract, same files, and the Finance module and the brief light up.

## Where Sage goes

The finance side of the canonical layer is already in place and empty. `types.ts` defines **LedgerAccount**, **Party**, **Invoice** and **BankTransaction**; `providers/types.ts` defines the **FinanceProvider** interface; the store has a `finance` section; `runSync` syncs it when a finance source is configured; `npm run show -- finance` and five finance questions in the brief read it. They light up the moment a provider is registered.

Create these, mirroring the BambooHR files:

```
src/data/canonical/sage/raw/types.ts      Sage's shapes, as its API returns them
src/data/canonical/sage/client.ts         OAuth token refresh, pagination, timeouts, typed errors
src/data/canonical/sage/normalize.ts      Sage to canonical, absent-not-default
src/data/canonical/sage/provider.ts       the FinanceProvider
src/data/canonical/sage/*.test.ts         tests, at least for normalize
```

The kit has no web server, so the one-time OAuth authorization is a small script or local listener of your own. `npm run sage:auth` is a suggested name, yours to add to `package.json`. It sends you to Sage's authorize URL, receives the callback on `SAGE_CALLBACK_URL`, exchanges the code, prints the business id, and stores the tokens under `.data/`, which is gitignored. Keep the token exchange and the token file in `src/data/canonical/sage/` so the script is a thin wrapper around them; in the satellite the same job is a route, and it calls the same code.

Then register the provider under `finance` in `src/data/canonical/providers/index.ts` (the slot is marked "register sage here"), set `FINANCE_SOURCE=sage` in `.env`, and `npm run sync`.

The finance questions the brief already understands: "how much cash do we have", "what did we invoice last month" (or "revenue last month"), "who owes us money" (or "overdue invoices"), "what did we spend on <account name> last month", and "biggest customers". Add patterns if you want; keep the contract (an answer, its figures, and what it cites).

**Done looks like this:**

- [ ] A client with OAuth token refresh, pagination and timeouts
- [ ] Raw types for what you pull
- [ ] `normalize.ts` that leaves absent what Sage did not supply, never defaults it
- [ ] The provider registered under `finance`, and `FINANCE_SOURCE=sage` documented
- [ ] `npm test` passes, with tests of your own
- [ ] `npm run show -- finance` shows Sage data, every figure with its source and synced-at
- [ ] `npm run ask` answers the two questions in THE PROBLEM
- [ ] A scheduled sync (`npm run cron`) picks up an invoice edited in Sage after the first sync

## Getting a Sage business to work against

Sage Accounting (the small business product, formerly Sage Business Cloud Accounting) has a public API, v3.1, and a free developer programme. Everything below is self serve and free; you never need credentials from Buki, and you must never use a real company's Sage business.

**1. Create your own Sage Accounting trial business (UK).** Sage's developer docs offer trial businesses for the United Kingdom (Canada and Ireland are marked currently unavailable). Use the Accounting Standard sign-up link from Sage's "Set up the Basics" guide: https://developer.sage.com/accounting/docs/v1.0.0/guides/quick-start/getting-started. It starts with your email and creates a 30-day trial. Use an email you control; an alias such as you+sage@gmail.com is handy if you need a second business. If the sign-up refuses your country, say so in Discussions the same day and we will give you a user on a Buki-owned trial business instead.

**2. Create an App Registry account and an app.** Sign up at https://developerselfservice.sageone.com/ (GitHub or email; the verification mail comes from donotreply@sageone.com). Click Create App, give it a name and at least one callback URL. The callback URL is whatever your auth script listens on; http://localhost:3000/api/sage/callback is a fine default (http is allowed for localhost; everything else must be https). You get a Client ID and Client Secret at once. Put them in your `.env` only.

**3. Load Sage's own test data.** Sage publishes a Postman collection plus JSON files that post hundreds of transactions (bank accounts, contacts, opening balances, sales and purchase invoices, payments, journals, products) into a UK VAT-registered Standard or Plus trial business: https://developer.sage.com/accounting/docs/v1.0.0/guides/quick-start/test-data-preparation and the page after it. The Postman environment and collection are at https://assets.devx.sage.com/assets/accounting/files/test-data/SBC_Accounting_environment_and_collection.zip and the data files at https://assets.devx.sage.com/assets/accounting/files/test-data/SBC_Accounting_Data.zip. It takes about 15 to 20 minutes. Every candidate loads the same pack, so submissions can be compared. Enable VAT first if the business is not VAT registered (Settings, Financial Settings, Accounting Dates and VAT; the guide gives a test VAT number).

**4. How the API works (from Sage's docs).**
- OAuth 2.0 authorization code flow only. Authorize at `https://www.sageone.com/oauth2/auth/central?filter=apiv3.1` with `client_id`, `response_type=code`, `redirect_uri`, optional `scope` (`readonly` or `full_access`), `country=gb`, `state`, and PKCE if you like. Exchange the code at `POST https://oauth.accounting.sage.com/token` (form encoded). The code is single use and expires in 60 seconds.
- Access tokens expire in 300 seconds. Keep the refresh token and refresh before each sync. Store tokens outside git (`.data/` is ignored).
- The user who authorizes must be a user of the trial business, not your App Registry login. That is the most common first-day mistake.
- Send `Authorization: Bearer <token>` on every call and `X-Business: <business id>` on every call except `GET /businesses`.
- Base URL `https://api.accounting.sage.com/v3.1/`. List responses are an envelope: `$total`, `$page`, `$next`, `$back`, `$itemsPerPage`, `$items`. Follow `$next` until it is null.
- Incremental reads: list endpoints accept `updated_or_created_since` (ISO 8601) and `items_per_page`; check each endpoint in the API reference, since availability varies by region and plan: https://developer.sage.com/accounting/apis/sagebusinesscloudaccounting/3.1.0/accounting.
- Resources you will care about: `ledger_accounts`, `contacts`, `sales_invoices`, `purchase_invoices`, `bank_accounts`, `bank_transactions` (and `transactions`), `journals`, `currencies`, `tax_rates`.
- Amounts come with VAT and a currency. Decide what "net" means in Buki and say so in your note.

**5. Make "a change in Sage".** Edit or add a sales invoice in the Sage web app after your first sync, then show the next scheduled sync picking it up.

## Rules

- **No real data and no real credentials, ever.** Your own trial business and your own developer app only. Nothing from an employer, a client, or a friend's company.
- **Secrets only in `.env`.** It is gitignored. Tokens the connector obtains go under `.data/`, also gitignored. If a secret lands in a commit, rotate it and tell us.
- **AI tools are welcome.** You are responsible for what you ship: you should be able to explain every line you submit.
- **Keep your connector under about 1,500 lines** of your own code. Less is fine. Reading it should take us an hour, not a day.
- **Post questions in this repository's Discussions**, not in private messages, so everyone sees the answers. There are no stupid questions and no penalty for asking.

## Day 3 and submitting

**By the end of day 3**, email a one-page plan to vivek@mybuki.ai: what you will pull from Sage, how it maps onto the canonical types, how it will stay in sync, and the questions you have. A page is plenty. We reply within a working day.

**To submit:** push your work to a private repository of your own (clone this kit, create an empty private repository on GitHub, point `origin` at it, push), add the GitHub user `vivekschandrasekar-beep` as a collaborator, and email vivek@mybuki.ai the repository link, the video link and the note (there is a template in `SUBMISSION_NOTE_TEMPLATE.md`). Do not open a public fork; other candidates would see your work.

## Who to ask

Vivek Chandrasekar, vivek@mybuki.ai.

---

Copyright MyBuki, Inc. Published for the Bring Sage into Buki evaluation. You may clone and change it for your submission. No other use.
