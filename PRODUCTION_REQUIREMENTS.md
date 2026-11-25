# IMS TARA MAA — approved quantity workflow

Approved 25 November 2026. This document supersedes piece-code, challan-matched return, and bill-matched company-return designs. AI assistant work remains paused.

## Stock

- Aggregate company/category balances. Optional preferred artwork on receipt; actual work chosen on artist send.
- Completed artwork combinations identify ready stock; no handwritten identifiers.
- Raw → artist → ready; ready → another artist for further art; count the physical item once.
- Internal disputes and reprint never become Company Return inventory.
- Artisan receipt starts with artisan selection. Only their positive pending production accounts and companies are eligible; no-stock artisans cannot enter a receipt. Category/work quantities post together without adding lines.
- A receipt can split quantity between Ready and same-artisan repaint. Disputed quantity must be a whole number within that receipt. Repaint is shown in Factory Disputes and artist pending using the same physical account; never duplicate it into factory hold or Company Return. Legacy hold receipts retain their historical meaning.
- Company Return uses a separate pool: receive from aggregate company-held stock → repair artist → ready → dispatch. No bill allocation.
- Raw rejected goods returned to source are separate from finished dispatch and cannot create finished-return eligibility.
- Total damage leaves usable custody; a separate damage document tracks replacement/settlement.
- Replace with compatible Own stock (Raw→Raw, Ready→Ready), order outside, or settle in cash / due adjustment / waiver. Ordering alone creates no stock.

## Finance and dispatch

- Bill and dispatch post atomically; date required, bill/GST number optional. Multiple entries on the same day are valid.
- One bill can include multiple product/art combinations, fresh finished goods, repaired company returns and raw dispute returns.
- Bill total entered manually. Zero-value repair/return bills allowed. Repair carries no automatic charge.
- Payments reduce aggregate company due, never require bill allocation. Overpayment is company credit.
- Return quantities and replacement purchase costs do not change financial due.
- Only explicit damage adjustment reduces due; it cannot exceed current positive due. Remaining damage remains unsettled.
- Money stored in integer paise.

## Opening

- Management/Owner review and confirm opening stock by company/category/location/artwork/pool/artist.
- Artist opening is one shared account, automatically counted in company totals; no duplicate company entry.
- Opening due or advance supported. Prior unsettled damage can be opened as Total Damage stock.
- Opening date shared across accounts. An account cannot be opened twice over existing stock or after regular movements start for that category.
- Existing live balances are imported exactly once. Old records stay archived. No historical reset is repeated.

## Access and corrections

- Existing Google-approved staff identities and roles retained. No OTP workflow added.
- Owner and Management operate inventory; only Owner changes staff access or deletes/reverses records.
- Handoff correction limited to seven days, creators/supervisor/management according to role. All corrections preserve original history.
- Downstream stock must remain nonnegative. Never force matching returns to a handoff.
- Sensitive artisan identity fields optional; not returned in general stock snapshots.
- Office Staff receives Own stock only. Office management may intake/return outside-vendor stock.
- Old quantity write paths disabled after migration to prevent split ledgers.

## UI

- Mobile bottom navigation and hamburger; desktop sidebar. Company profile has Stock, Khata, Reports, Damage Charge.
- Dedicated Company Return and Dispatch Done screens. Artisan profiles, multi-specialization creation/editing.
- Quantity/remaining preview, multiline entry, draft recovery, retry-safe saving, history search/export/print.
- Fix Issues shows held disputes, overdue pending stock and unsettled documents. Current default ageing threshold: seven days.

## Verification and rollout

- `node scripts/test-production.mjs`: business state transitions and rejection checks.
- `node --env-file=.env scripts/test-production-api.mjs`: PostgreSQL migration and real route tests inside a rollback transaction.
- `npm run typecheck` and `npm run build`.
- Private pre-cutover backup in ignored `output/backups/` (never commit).
- Migration is additive; do not rerun it or use reset. Apply exactly once, then publish matching app commit.
