# AGENTS.md

This repository is the NetSuite SuiteCloud/SDF project for Landed Cost Management.

## Project Scope

- Work on NetSuite custom records, SuiteScripts, SDF objects, and the requirements docs under `docs/`.
- Treat `docs/lcm_record_reference_and_requirements.md` and `docs/lcm_implemented_requirements.md` as the current functional reference.
- Keep customer-demo feedback reflected in both implementation and docs before considering a change complete.
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
- Root record shipment numbering should use NetSuite custom record auto-numbering; the old text field `custrecord_lcm_shipment_number` is legacy compatibility only.
- `LCM Items` should include only PO item lines that are receivable and still have remaining quantity to receive.
- `Expected Quantity Receipt` means PO quantity still open for receipt.
- `Quantity Receipt` is editable and means the quantity to receive and bill through this LCM record.
- `Quantity Remaining` is expected receipt quantity minus current quantity receipt.
- `Bill Status` is `full` when expected quantity equals receipt quantity, otherwise `partial`.
- `PO Value` is `PO Rate * PO Exchange Rate * Quantity Receipt`, so it is comparable with base-currency landed-cost allocation.
- `Total Value` is `Total Unit Cost * Quantity Receipt`; `Total Unit Cost` already includes converted PO rate plus allocated landed cost.
- `Quantity Bill` is no longer user-facing.
- Each Landed Cost row must have its own `Vendor Name`; bills are grouped by that vendor so one LCM record can create multiple Vendor Bills.
- Landed Cost `Bill Line Type` is always `Item` and should be hidden.
- Landed Cost `Bill Type` is always `LC Bill` and should be hidden.
- The user-facing Landed Cost `LC Cost Category` field is `custrecord_lcm_lcm_cost_item_map`, a selector to active `customrecord_lcm_cost_item_map` records.
- Legacy/native Landed Cost category fields (`custrecord_lcm_lcm_cost_profile` and `custrecord_lcm_lcm_cost_category`) are hidden derived/compatibility fields.
- `LC Cost Item` sourcing must use the selected `customrecord_lcm_cost_item_map` row. Do not reintroduce exact same-name item matching as a user-facing fallback.
- Each active `customrecord_lcm_cost_item_map` row maps one native LC Cost Category to one active LC Cost Item; duplicate active mappings for the same category are invalid.
- Landed Cost `Currency` and `Exchange Rate` are editable, defaultable values.
- `LC Cost Item`, `Department`, and `Class` are not user-facing in the landed-cost sublist.

## Verification

- Prefer `npm run validate` after SDF object or SuiteScript changes.
- If validation cannot run because SuiteCloud is not authenticated or the account is unavailable, report that explicitly.
- Do not deploy unless the user asks for deployment.
