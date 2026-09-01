# Landed Cost Management - Code Review

Reviewed: 2026-08-26
Branch: `16Apr_2026`
Scope: whole project - 8 script files (~1,760 lines JS), 6 SDF record/list objects, 5 script deployments, 3 design docs.

Findings were read from source. No code was executed against a NetSuite account. Governance figures use the documented SuiteScript 2.x unit costs (custom record save/delete 4, `submitFields` 2) against the 1,000-unit User Event and Suitelet limits.

| Severity | Count |
| --- | --- |
| Critical | 5 |
| High | 9 |
| Medium | 10 |
| Low | 5 |
| **Total** | **29** |

---

## Verdict

The architecture is better than most NetSuite customizations of this size: every record and field ID lives in one config module, the accounting flow previews before it commits, and the docs are honest about their own caveats. The code is not, however, ready to carry financial postings in production.

Three things stand out:

- **Nothing in this directory is under version control** - there is no recoverable history for any of it.
- **The delete-and-rebuild sync destroys allocation results** that only the accounting flow can produce, including on the very first save.
- **Currency is handled inconsistently** between what gets posted to the ledger and what gets allocated onto inventory.

---

## 1. Release readiness

These stop the project from being deployable or recoverable by anyone other than the current developer, on this one account.

### R-01 - The entire project is untracked by git

**Critical** | `git ls-files` returns 0 files

`git status` reports the whole directory as a single untracked entry (`?? ./`), and `git ls-files` returns nothing. Not one script, XML object, or doc has ever been committed - there is no history, no diff, no rollback, and nothing on a remote. Every finding below is currently a one-way edit.

**Fix:** Commit before touching anything else. `.gitignore` already excludes `project.json` and `node_modules`, so the tree is clean to add as-is.

### R-02 - All five deployments ship as TESTING with DEBUG logging

**Critical** | `src/Objects/customscript_*.xml` (5 files)

Every `<status>` is `TESTING` and every `<loglevel>` is `DEBUG`. In TESTING, only the script owner can execute the deployment - for every other user the PO-selection client script, both Suitelets, and both user events silently do nothing or error. Combined with `allroles=T`, the intent was clearly broad access; the status contradicts it.

**Fix:** Move to `RELEASED` and drop log level to `AUDIT` or `ERROR` for the two user events, which run on every save.

### R-03 - The Bill Type field the code depends on is not in the SDF project

**Critical** | `lcm_po_selection_config.js:42`, `customrecord_lcm_landed_cost.xml:51`

Config points `billType` at `custrecord_lcm_lcm_cost_bill_type`, which appears nowhere in the project - only inside the description text of a different field. The field that *is* in the SDF, `custrecord_lcm_lcm_bill_type`, is labelled "Deprecated Bill Type" and hidden. So the live field exists only in account 9385847, created by hand.

Deploy this project to a fresh account and `validateRow` rejects every single bill row with "Bill Type is required for Vendor Bill" - the Create Bill flow is dead on arrival, with no error pointing at the missing field. There is also a standing risk that an SDF deploy of the record definition prunes the unmanaged field and its data.

**Fix:** Import the real field into `customrecord_lcm_landed_cost.xml` so the project is self-contained, then retire the deprecated duplicate in a separate deploy.

### R-04 - `custbody12` is an account-generated ID hardcoded as config

**High** | `lcm_po_selection_config.js:88`

The Vendor Bill body field is referenced by its auto-numbered internal ID. `custbody12` means nothing outside this one account, is not declared in `manifest.xml`, and will silently point at a different field - or none - in a sandbox or a second subsidiary's account. The docs record the decision, but the manifest doesn't enforce it.

**Fix:** Declare it as a manifest dependency at minimum. Better: create a properly-named transaction body field and migrate.

---

## 2. Data integrity

The delete-and-rebuild strategy treats LCM Items as pure derived data. Two fields on that record aren't derived - they're written by the accounting allocation - and the rebuild destroys them.

### D-01 - "Select All Track Items" is always undone by the first save

**Critical** | `lcm_po_selection_lib.js:199`, `lcm_po_selection_user_event.js:76`

On create the user picks POs, clicks **Select All Track Items**, and saves. NetSuite writes the child rows with the checkbox set. Then `afterSubmit` fires, `shouldSyncPoItems` returns `true` unconditionally for `CREATE`, and `syncPersistedItems` deletes every row it just wrote and recreates them - with `trackItem` hardcoded to `false`.

The user lands on a saved record with every box cleared, and because the accounting flow blocks when nothing is tracked, Create Bill refuses to run. The button the docs specifically list as available in create mode cannot work in create mode.

**Fix:** Carry `trackItem` forward by `poLineKey` when rebuilding, or skip the server sync entirely when the client script already populated the sublist.

### D-02 - Changing the PO selection erases allocated landed cost

**Critical** | `lcm_po_selection_lib.js:165-225`, `lcm_accounting_lib.js:534-545`

`allocateCreatedCosts` accumulates into `custrecord_lcmitems_unit_landed_cost` and `custrecord_lcmitems_total_unit_cost`. Those values exist nowhere else - they are not recomputable from the PO. `createLcmItem` never sets them, so after any edit that adds or removes a PO, every item row comes back with both fields blank.

Meanwhile the Landed Cost rows keep their `Created` status and their Vendor Bill / Journal references, and the row-lock user event actively prevents re-running them. The posted accounting and the item costing diverge permanently, with no path back. The docs' caveat covers "future manually editable item fields" - it doesn't cover these, which the system writes itself.

**Fix:** Reconcile by `poLineKey` instead of truncating: add new lines, remove lines whose PO is gone, and leave matched lines untouched. Block PO-selection changes outright once any Landed Cost row is `Created`.

### D-03 - Transactions commit before the rows that guard against duplicates

**High** | `lcm_accounting_lib.js:102-109, 459`

`createVendorBill` saves the bill, and only then does `markCostRowsCreated` stamp status and transaction ID onto the Landed Cost rows. If anything fails in that window - governance limit, a locked record, a field permission - the bill is posted in the ledger while the rows still look unprocessed. The next Create Bill run happily posts a second bill for the same cost.

The same loop then calls `allocateCreatedCosts`, which can itself throw. There is no transaction boundary across the four steps and no compensating reversal.

**Fix:** Write a claim marker onto the rows before saving the transaction, and reconcile on the next run. Failing that, log the created transaction ID immediately and surface unreconciled rows in a saved search.

### D-04 - Appending lines mutates an already-posted Vendor Bill

**High** | `lcm_accounting_lib.js:441-443, 485-487`

When a new row matches a group that already produced a transaction, the code `record.load`s that Vendor Bill or Journal Entry and adds lines to it. Nothing checks whether the bill has been approved, paid, applied to a credit, or closed in a shut accounting period. Editing a posted, possibly-paid document is a control problem before it is a technical one - and if two bills exist for the same key, `buildExistingTransactionsByKey` picks whichever the search returned first.

**Fix:** Check status and period before appending, and fall back to a new transaction when the existing one isn't safely open. Surface the choice in the preview.

---

## 3. Accounting correctness

Currency is the weak seam. Three different bases are in play - Landed Cost row currency, PO line currency, and whatever the transaction sources - and the code mixes them.

### A-01 - Journal grouping ignores currency, and the JE currency is never set

**High** | `lcm_accounting_lib.js:419-423, 484-493`

`buildGroupKey` keys bills on vendor, subsidiary, bill type *and* currency - but keys journals on subsidiary alone. Two Landed Cost rows in USD and EUR under one subsidiary collapse into a single Journal Entry, and `createJournalEntry` never sets `currency` on it. Both rows post at face value in whatever currency the JE defaulted to.

**Fix:** Add currency to the journal group key and set it explicitly on the JE, matching the bill path.

### A-02 - The amount posted and the amount allocated use different bases

**High** | `lcm_accounting_lib.js:466, 507, 527`

The bill and journal lines are written with `row.amount` raw. The allocation uses `row.amount * row.exchangeRate`. When the exchange rate is anything other than `1`, the value landed on inventory does not equal the value posted to the ledger - the two go out of balance by exactly the FX factor, quietly.

**Fix:** Decide one canonical basis - almost certainly subsidiary base currency - convert once at the edge, and use that single number for both the posting and the allocation.

### A-03 - `totalUnitCost` adds two different currencies together

**High** | `lcm_accounting_lib.js:541`

`roundCurrency((item.poRate || 0) + newUnitLandedCost)` sums the PO line rate, which is in the PO's transaction currency, with a landed cost that has already been multiplied by an exchange rate. For any foreign-currency PO the resulting Total Unit Cost is arithmetically meaningless. The same mixing appears in the Amount weighting at line 555, where `quantity * poRate` compares PO rates across lines that may be in different currencies.

**Fix:** Convert `poRate` to the same basis as the landed cost before adding, and weight on converted values.

### A-04 - Allocation weights on ordered quantity, not received

**Medium** | `lcm_accounting_lib.js:339`

`fetchTrackedItems` reads its `quantity` from `custrecord_lcmitem_ex_receipt`, which the sync fills with the PO's *ordered* quantity. Landed cost is normally spread over what actually arrived. On a partially-received shipment - the common case for the LC workflow this record models - cost lands on units that aren't in inventory yet.

**Fix:** Confirm the intended basis with the client; if it's receipts, weight on `custrecord_lcmitems_receipt` and exclude zero-receipt lines.

### A-05 - One invalid row blocks the entire batch with no override

**Medium** | `lcm_accounting_lib.js:75-89`

`validateRow` failures push into `preview.errors`, and `preview.ok` requires that array to be empty - so a single row missing an expense account hides the Confirm button for every other valid row. Defensible as all-or-nothing, but with no way to exclude a row it becomes a hard stop on a large batch.

**Fix:** Separate row-level errors from batch-level ones: list bad rows as skipped and let the valid groups proceed.

---

## 4. Scale and governance

User events and Suitelets both get 1,000 usage units. The write patterns here are linear in line count and, in one case, quadratic.

### G-01 - The save-time sync runs out of governance around 120 item lines

**High** | `lcm_po_selection_lib.js:165-225`

Each line costs a `record.delete` plus a `record.create`/save - 4 units each on a custom record, so 8 per line, against the 1,000-unit user event budget (three searches take ~30 more). Somewhere past 120 lines the script hits `SSS_USAGE_LIMIT_EXCEEDED` partway through, leaving the record saved with a partially-rebuilt child set. An LC covering several POs of imported goods reaches that easily, and there is no `getRemainingUsage` check to fail gracefully.

**Fix:** Reconciling instead of truncating (D-02) removes most of the writes. For genuinely large sets, hand off to a Map/Reduce and show progress on the record.

### G-02 - Allocation rewrites every tracked item once per transaction group

**High** | `lcm_accounting_lib.js:102-109, 513-546`

`allocateCreatedCosts` is called inside the group loop, and each call re-searches the tracked items and submits `unitLandedCost` / `totalUnitCost` for *all* of them. With G groups and T tracked items that is G x T `submitFields` calls at 2 units each - five groups over a hundred tracked items exhausts the Suitelet's entire budget on redundant writes.

**Fix:** Accumulate increments across all groups in memory, then write each item exactly once after the loop.

### G-03 - Four searches use `.each()`, which stops at 4,000 results

**Medium** | `lcm_po_selection_lib.js:92, 148`, `lcm_accounting_lib.js:164, 336`

`ResultSet.each` silently stops after 4,000 rows. For `eachExistingLcmItem` that means `deleteExistingLcmItems` would leave orphaned children behind and report a lower count - no error, just quietly incomplete. The truncation is invisible at every call site.

**Fix:** Switch to `runPaged` with an explicit page loop, or assert the count and throw when it hits the ceiling.

### G-04 - Vendor defaults are looked up once per row, uncached

**Medium** | `lcm_accounting_lib.js:214, 232-249`

`fetchLandedCostRows` ends in `rows.map(enrichRowFromVendor)`, and each call does its own `search.lookupFields`. Ten rows for the same freight forwarder means ten identical round trips. The results are immutable within a request, so this is free to fix.

**Fix:** Memoize `getVendorDefaults` on `vendorId` in a module-scoped map.

### G-05 - A full Vendor Bill record is constructed just to read defaults

**Medium** | `lcm_accounting_lib.js:251-269`, `lcm_landed_cost_lock_user_event.js:49`

`getVendorBillDefaults` calls `record.create({ type: VENDOR_BILL, isDynamic: true })` and sets `entity` purely to observe what NetSuite sources. Dynamic-mode sourcing is a server round trip per field, and this runs in `beforeSubmit` on every Landed Cost row create - inside the user's save. It is a clever trick that puts real latency on the critical path.

**Fix:** Read subsidiary, currency and expense account from the vendor with `lookupFields`, and keep the draft-bill trick only for fields that genuinely have no other source.

### G-06 - Allocation-method lookup brute-forces six field names via exceptions

**Medium** | `lcm_accounting_lib.js:277-303`

`lookupCostCategoryAllocationMethod` loops two record types x three guessed column names, catching and discarding the failures, then falls back to `'Quantity'`. Up to six failing lookups run on every cost-category change and every row create. Exceptions as control flow across guessed schema is fragile, slow, and the empty catch hides genuine permission errors.

**Fix:** Determine the real field for this account once, hard-code it, and let a lookup failure surface as a logged warning rather than a silent default.

### G-07 - Two `submitFields` calls per row where one would do

**Low** | `lcm_accounting_lib.js:561-592`

`markCostRowsCreated` and `markCostRowsAllocated` each iterate the same rows and each issue their own `submitFields`. Merging them halves the unit cost and removes a window where a row is marked created but not allocated.

**Fix:** Set `costAllocatedInGrn` in the same values object as the status stamp.

---

## 5. Configuration and hygiene

### H-01 - No linting, no tests, no CI on code that posts to the general ledger

**High** | `package.json` - 3 scripts, all suitecloud

There is no ESLint config, no test runner, and no `.github/`. The pure functions here are the easy, high-value targets - `buildAllocationWeights`, `buildGroupKey`, `normalizeIds`, `toNumber`, `validateRow` - all testable with no NetSuite stub at all. Every currency bug in this report is a unit test that would have caught it.

**Fix:** Add ESLint with the SuiteScript AMD globals, then Jest over the pure helpers. Wire both into `npm run validate` so they gate deploys.

### H-02 - Quantities are stored as free text and currency

**Medium** | `customrecord_lcmitems.xml`

`custrecord_lcmitem_ex_receipt`, `custrecord_lcmitems_receipt`, `custrecord_lcmitems_quantity_remaining` and `custrecord_lcmitems_exchange_rate` are all `TEXT`, while `custrecord_lcmitems_quantity_bill` is `CURRENCY`. Allocation math therefore depends on parsing strings back out of the database, no saved search can sum or sort these columns, and a locale that formats decimals differently corrupts the values.

**Fix:** Retype the three quantities as `FLOAT` and the exchange rate as `FLOAT`, in a migration that converts existing values.

### H-03 - The client script is attached twice, by two different mechanisms

**Medium** | `lcm_po_selection_user_event.js:16`, `customscript_lcm_po_selection_cs.xml`

`beforeLoad` sets `form.clientScriptModulePath` to the same file that already has a ClientScript deployment on `customrecord_landed_cost_management`. Both registrations can fire, and the module-level `syncing` guard is per-instance - so it will not prevent a doubled sublist rebuild across two instances. Each rebuild is also a blocking `https.get`.

**Fix:** Keep the deployment record and drop the `clientScriptModulePath` assignment; the view-mode buttons work either way.

### H-04 - The accounting Suitelet trusts a POSTed parent record ID

**Medium** | `lcm_accounting_suitelet.js:62-69`

`renderResult` takes `custpage_parent_id` straight from the request and creates Vendor Bills and Journal Entries for it. The deployment is `allroles=T`, and there is no check that the caller may act on that particular LCM record. Anyone who can reach the Suitelet can post transactions for any LCM record by changing one hidden field.

**Fix:** Load the parent record server-side and verify the user's permission before creating anything, and narrow the deployment's roles to those that should post.

### H-05 - `manifest.xml` dependencies no longer describe the project

**Medium** | `src/manifest.xml:15-23`

The object list declares `customrecord_landed_cost_management`, `customrecord_lcmitems` and `customrecord_lcm_landed_cost` as external dependencies even though all three ship *in* the project, while the genuine account prerequisites it does name - `customlist_lc_type`, `customlist_lc_status`, `customlist_bill_type`, `customlist_wmsse_ports` - sit alongside two undeclared ones, `custbody12` and `custrecord_lcm_lcm_cost_bill_type`. Validation cannot tell you what a target account is actually missing.

**Fix:** Regenerate with `suitecloud project:adddependencies` once R-03 and R-04 are settled.

### H-06 - A formatted date string is written into a DATE field via `submitFields`

**Low** | `lcm_accounting_lib.js:573`, `lcm_landed_cost_lock_user_event.js:42`

`markCostRowsCreated` passes `todayDateText()` - a locale-formatted string - as the value for `custrecord_lcm_lcm_created_date`. `submitFields` has value semantics, not text semantics; the user event does the same job correctly with `setText`. Behaviour here depends on account date format.

**Fix:** Pass a `Date` object, and share one date helper instead of two.

### H-07 - `poLineKey` is written and read but never used

**Low** | `lcm_po_selection_lib.js:119, 159, 213`

The key is generated, stored on every child row, and selected back in `eachExistingLcmItem` - where `deleteExistingLcmItems` then uses only `row.id` and discards it. Its only live role is within-run dedupe. It is exactly the reconciliation key D-01 and D-02 need; the delete-and-rebuild approach threw away the mechanism that would fix them.

**Fix:** Use it. Also note the fallback branch keys on a running `lineIndex` that depends on search result order, so it is not stable across runs.

### H-08 - `N/error` is shadowed by a catch parameter

**Low** | `lcm_landed_cost_lock_user_event.js:5, 79`

The module imports `N/error` as `error`, and `sourceAllocationMethodDefault` then catches into `error` too. Harmless today because that block is empty - but the file's whole purpose is throwing `error.create`, so the next person to add a throw inside that catch gets a confusing failure.

**Fix:** Rename the catch binding, and log rather than swallow.

### H-09 - Five helpers are defined twice across modules

**Low** | 3 files

| Helper | Defined in |
| --- | --- |
| `normalizeIds` | client, po_selection_lib |
| `toNumber` | accounting_lib, po_selection_lib |
| `setIfPresent` | accounting_lib, po_selection_lib |
| `setCurrentIfPresent` | accounting_lib, client |
| `todayDateText` | accounting_lib, lock_user_event |

The copies have already drifted - the two `setCurrentIfPresent` variants differ in whether they pass `ignoreFieldChange`. H-06 is a drift bug in `todayDateText`'s two callers.

**Fix:** Add a `lcm_util` module beside the config module; all three consumers already load config, so the dependency shape is proven.

---

## What's working

- **One config module owns every ID.** `lcm_po_selection_config.js` centralizes records, fields, sublists and deployment IDs, and all three consumers use it. That discipline is why this review could verify the schema against the code at all - and why R-03 was findable in one grep.
- **Preview before commit.** Routing Create Bill and Create Journal through a Suitelet that shows groups, amounts and skip reasons before anything posts is the right shape for financial automation, and the append-vs-create intent is stated in the preview.
- **Duplicate posting is guarded at the row level.** Status plus created transaction ID, checked in `isCreated` and enforced again by a row-lock user event, is a real control - D-03 is a gap in *where* it is applied, not whether it exists.
- **Output is escaped.** The Suitelet runs every interpolated value through `escapeHtml`, including in the error path.
- **The docs are unusually good.** Three files covering requirements, record reference, and deployment - with a "Known Notes and Cleanup Items" section that honestly records the orphan field, the PO Currency mistyping, and the `custbody12` decision. Most projects this size have none of this.

---

## Suggested order of work

Sequenced because several of these unblock each other - reconciliation by key fixes three findings at once.

1. **Commit everything** (R-01). Nothing else is safe to attempt first.
2. **Import the Bill Type field into the SDF** (R-03) and declare `custbody12` (R-04), so the project describes itself.
3. **Replace delete-and-rebuild with reconcile-by-`poLineKey`** - this resolves D-01, D-02, G-01 and H-07 together, and is the single highest-value change in the list.
4. **Fix the currency basis** (A-01, A-02, A-03) with unit tests written first, since these are pure functions.
5. **Hoist allocation out of the group loop** (G-02) and merge the two row stamps (G-07).
6. **Close the posting window** (D-03) and add the open-transaction check before appending (D-04).
7. **Release the deployments** (R-02) and lower log levels - last, once the above holds.
