# AGENTS.md

This repository is the NetSuite SuiteCloud/SDF project for Landed Cost Management.

## Project Scope

- Work on NetSuite custom records, SuiteScripts, SDF objects, and the requirements docs under `docs/`.
- Treat `docs/lcm_record_reference_and_requirements.md` and `docs/lcm_implemented_requirements.md` as the current functional reference.
- Keep customer-demo feedback reflected in both implementation and docs before considering a change complete.
- Keep the Confluence project record current: whenever a new day of work or a new requirement is introduced, update both `001 Project plan` and `002 Meeting notes` with the dated/time-stamped status, decisions, implementation changes, and open follow-ups.
- Treat `001 Project plan` as the current-state snapshot. Treat `002 Meeting notes` as an append-only, stacked meeting/work log: add each new dated entry at the top, keep the newest entry first, and preserve earlier entries below it instead of replacing the history with one consolidated table.
- Do not invent NetSuite account-specific internal IDs. When an ID is account-generated or uncertain, keep it configurable or document the account dependency.

## Repo Conventions

- Shared record IDs, field IDs, sublist IDs, script IDs, and constants belong in `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_config.js`.
- PO line discovery and persisted `LCM Items` reconciliation belong in `lcm_po_selection_lib.js`.
- Browser form behavior belongs in `lcm_po_selection_client.js`.
- Header/root record form behavior belongs in `lcm_po_selection_user_event.js`.
- Item child-row save validation and derived quantity/value recalculation belong in `lcm_items_user_event.js`.
- Landed Cost child-record locking/defaulting belongs in `lcm_landed_cost_lock_user_event.js`.
- Accounting preview and transaction creation belong in `lcm_accounting_suitelet.js` and `lcm_accounting_lib.js`.
- SDF object labels, visibility, mandatory flags, and custom fields must be kept in `src/Objects/*.xml`.

## Current Business Rules

- Header `custrecord_lcm_vendor` is the Purchase Order Vendor used to filter and validate selected POs.
- Header `custrecord_lcm_selected_pos` is the stored selected PO list; users should populate it through the `Select Receivable POs` Suitelet so fully received/non-receivable POs are not selectable in normal UX.
- Header `custrecord_lcm_shipment_status` is dynamic: `To Be Shipped` before any Landed Cost row exists, `In Transit` while Bill rows are pending GRN allocation, `Partially Received` after allocation when any Items row is partial, and `Received` after allocation when all Items rows are full.
- Root record shipment numbering should use NetSuite custom record auto-numbering; the old text field `custrecord_lcm_shipment_number` is legacy compatibility only.
- `LCM Items` should include only PO item lines that are receivable and still have remaining quantity to receive.
- `Expected Quantity Receipt` means PO quantity still open for receipt.
- `Quantity Receipt` is editable and means the quantity to receive and bill through this LCM record.
- `Quantity Remaining` is expected receipt quantity minus current quantity receipt.
- `Receive Status` (`custrecord_lcmitems_bill_status`) is `full` when expected quantity equals receipt quantity, otherwise `partial`.
- `PO Value` is `PO Rate * PO Exchange Rate * Quantity Receipt`, so it is comparable with base-currency landed-cost allocation.
- `Total Value` is `Total Unit Cost * Quantity Receipt`; `Total Unit Cost` already includes converted PO rate plus allocated landed cost.
- `Quantity Bill` is no longer user-facing.
- Each Landed Cost row must have its own `Vendor Name`; bills are grouped by vendor, subsidiary, and currency so one LCM record can create multiple Vendor Bills. Exchange rate does not split a same-vendor/same-currency bill; the first transaction exchange rate is retained, while each source row's exchange rate remains authoritative for base-currency allocation.
- Compatible Landed Cost rows are merged into one Vendor Bill item line when Vendor, Subsidiary, Currency, LC Cost Category, LC Cost Item, and Allocation Method all match. If Effective Date, Location, Department, or Class differ inside that merge group, the generated Bill line uses the first source row's values. The merged line has quantity `1`, rate and amount equal to the summed source amount, and the distinct source memos as its description.
- Merge identity must be deterministic and built from internal IDs, never from display text alone. The `customrecord_lcm_cost_item_map` selection is the source of truth: rehydrate the hidden native Cost Category and LC Cost Item from it before validating a row and before building a merge key. Do not merge different categories, different items, or different allocation methods.
- When appending to an existing generated Vendor Bill, compatible new rows must be absorbed into matching existing cost lines and duplicate generated lines consolidated. Existing-line matching must also be ID-first so sourced or parent-prefixed display text cannot hide a match. `Recalculate Landed Cost` repairs allocation only and must not rewrite an already-created Vendor Bill.
- A Vendor Bill line may only be rewritten or removed when the LCM record can prove it created it: the matched lines must total exactly what its Landed Cost rows created against that Bill for that category and item. Otherwise add a new line and report it. A Vendor Bill line carries no ownership marker, so this arithmetic check is the proof.
- A consolidation that cannot tag its surviving line with the Cost Category must be abandoned before the commit, never completed.
- `Cost Allocation Method` is a Vendor Bill body field, so one Bill carries one method. Refuse a vendor/subsidiary/currency group whose rows disagree about it rather than writing a Bill whose header misdescribes some of its cost lines. Do not change the grouping rule to work around this.
- A Landed Cost row whose mapping does not resolve to a Cost Category and an active LC Cost Item must fail validation. Never fall back to the stale hidden values it was supposed to derive.
- `Repair Vendor Bill Lines` is the only action permitted to edit an already-created Vendor Bill. It is explicit, previewed, confirmed, ownership-checked, and total-preserving. Historical transactions must never be mutated silently.
- Landed Cost `Bill Line Type` is always `Item` and should be hidden.
- Landed Cost `Bill Type` is always `LC Bill` and should be hidden.
- The user-facing Landed Cost `LC Cost Category` field is `custrecord_lcm_lcm_cost_item_map`, a selector to active `customrecord_lcm_cost_item_map` records.
- Hidden native `Cost Category` (`custrecord_lcm_lcm_cost_category`) is derived from the mapping selector and is required for Vendor Bill landed-cost tagging and GRN allocation. The former `Legacy LC Cost Category` field (`custrecord_lcm_lcm_cost_profile`) is retired and must not be reintroduced.
- `LC Cost Item` sourcing must use the selected `customrecord_lcm_cost_item_map` row. Do not reintroduce exact same-name item matching as a user-facing fallback.
- Each active `customrecord_lcm_cost_item_map` row maps one native LC Cost Category to one active LC Cost Item; duplicate active mappings for the same category are invalid.
- Landed Cost `Document Type` defaults to `Bill`.
- Landed Cost `Currency` and `Exchange Rate` are editable; changing currency should refresh the exchange rate from a sourced Vendor Bill context.
- Landed Cost `Effective Date` is mandatory and defaults to today's date.
- Landed Cost `Location` defaults from the first selected PO location when available.
- Landed Cost `Cost Allocated In GRN` is checked only after item-level landed-cost allocation succeeds; created-but-unallocated Bill rows can be repaired through `Recalculate Landed Cost`.
- `Recalculate Landed Cost` must not create or append Vendor Bills. It recalculates item landed cost fresh from all created Bill-type Landed Cost rows and then marks those rows allocated.
- `LC Cost Item`, `Department`, and `Class` are not user-facing in the landed-cost sublist.
- Canonical Landed Cost fields are the current Vendor Name, Bill Type, mapped LC Cost Category, and LC Cost Item fields. The duplicate legacy Vendor Name, Deprecated Bill Type, Expense Account, Bill Item, Debit Account, and Credit Account fields are retired and must not be reintroduced. The hidden native Cost Category remains for Vendor Bill tagging and GRN allocation; the former Legacy LC Cost Category field is retired. Journal accounts are script-configured rather than stored on each Landed Cost row.

## Verification

- Prefer `npm run validate` after SDF object or SuiteScript changes.
- If validation cannot run because SuiteCloud is not authenticated or the account is unavailable, report that explicitly.
- Do not deploy unless the user asks for deployment.
