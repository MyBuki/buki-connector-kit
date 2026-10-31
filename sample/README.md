# The sample

`finance.sample.json` is the books of Halden Labs, the made-up company whose people are in the mock BambooHR, as a Sage connector would hand them to Buki: the four canonical collections, every id prefixed `sage:`, every optional field either carrying a value or absent. Nothing in it is real.

Run it through the validator and the brief:

```
npm run check -- sample/finance.sample.json
```

It passes with zero errors and zero warnings. Change a record and run it again to see what the validator says. Each record is there to show one thing.

## Accounts (9)

| Id | Shows |
| --- | --- |
| `acc-1200` Operating account, `acc-1210` Reserve account | Two bank accounts, both assets. A bank transaction's `bankAccountId` points at one of these, and cash is summed per account. |
| `acc-1100` Trade debtors, `acc-2100` Trade creditors, `acc-3000` Share capital | One asset, one liability, one equity account. They hold no figures here; they show the `type` enum. |
| `acc-4000` Sales | The income account every sales invoice line posts to. |
| `acc-5000` Contractors | An expense account with no invoice lines. It appears only as the `accountId` of two bank transactions, so it never reaches the spend table, which reads purchase invoice lines. |
| `acc-7100` Rent, `acc-7500` Software subscriptions | The two expense accounts the purchase invoices post to, and the ones "what did we spend on software last month" finds by name. |

## Parties (5)

| Id | Shows |
| --- | --- |
| `con-2001` Northgate Analytics | A customer with two live sales invoices, one paid and one open with no due date. The biggest customer by invoiced. |
| `con-2002` Pinecrest Health | A customer with one overdue invoice and one draft. |
| `con-2003` Tolliver & Reed LLP | A customer with no `email`. The field is absent, not `null` and not `""`. That is the one rule. |
| `con-2004` Ovelo Cloud | A supplier (hosting). Its invoice is dated October. |
| `con-2005` Bluestem Workspace | A supplier (the office). Its invoice is dated September, and its payment is the first bank transaction. |

## Invoices (8)

| Id | Shows |
| --- | --- |
| `si-3001` sales, paid | Dated September, `outstanding` 0. Counts toward September's invoiced total and Northgate's rank, not toward overdue. |
| `si-3002` sales, unpaid | Dated September, due 15 October. Overdue once the calendar passes the due date. |
| `si-3003` sales, part_paid | Total 6,000, outstanding 2,500. Overdue; only the 2,500 is counted. The 3,500 paid is bank transaction `bt-5006`. |
| `si-3004` sales, draft | Dated October. Left out of every figure. |
| `si-3005` sales, void | Dated October, `outstanding` 0. Left out of every figure. |
| `si-3006` sales, unpaid, no `dueDate` | Dated October. It is open, so it counts toward what Northgate owes, but it is neither overdue nor current: "1 open invoice has no due date on file and is not counted". |
| `pi-3101` purchase, paid | Dated September, from Bluestem. Two lines: Rent 8,500 and Software subscriptions 300. This is September's spend table. |
| `pi-3102` purchase, unpaid | Dated October, from Ovelo. Two lines, both Software subscriptions, 2,350 together. This is October's spend table, and the answer to "software last month" once November starts. |

Every invoice carries `lines`, even when there is one line. `total` is the invoice total; `net` on a line is that line's net. The sample has no tax, so they add up; a real Sage invoice will not, and your note should say what you did with VAT.

## Bank transactions (10)

| Id | Shows |
| --- | --- |
| `bt-5001` | Money out, with a `partyId` (the supplier paid) and no `accountId`: a payment against an invoice. |
| `bt-5002`, `bt-5007` | Money out, with an `accountId` (Contractors) and no `partyId`: a payment posted straight to an expense account. |
| `bt-5003` | A card payment posted to Software subscriptions with no invoice behind it. It is cash out, but it is not in the spend table, which reads invoice lines. |
| `bt-5004`, `bt-5009` | A transfer between the two bank accounts: +60,000 in one, (60,000) in the other. Total cash does not move. |
| `bt-5005`, `bt-5006` | Money in from customers, with a `partyId`. |
| `bt-5008` | The large deposit that gives the reserve account its balance. |
| `bt-5010` | Interest: a small positive amount with no party and no account. |

Amounts are signed: money in is positive, money out is negative. Cash per account is the sum of these, which is why the Finance module calls it a running total from the transactions on file, not a statement balance.
