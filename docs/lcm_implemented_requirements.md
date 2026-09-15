# Landed Cost Management - Implemented Requirements

Last updated: 2026-09-10

This document tracks implemented behavior for the Landed Cost Management customization. Extend this file chunk by chunk as new requirements are added. For record and field references, see [lcm_record_reference_and_requirements.md](./lcm_record_reference_and_requirements.md).

## 1. Header-Level PO Selection

Users should select Purchase Orders once at the root/header level instead of choosing PO independently on each item child line.

Implemented behavior:

- Added root field `Purchase Order Vendor` (`custrecord_lcm_vendor`) as the header vendor for PO selection only.
- Added root field `Selected Purchase Orders` (`custrecord_lcm_selected_pos`) as a multi-select Purchase Order field.
- The root `Subsidiary` field (`custrecord_lcm_subsidiary`) is sourced from the selected Purchase Order Vendor and disabled on the form by User Event `beforeLoad`.
- The root `Selected Purchase Orders` field is disabled on the form and populated through the `Select Receivable POs` Suitelet button.
- The existing child line `PO` field remains as a reference field on `LCM Items`.
- PO selection is filtered and validated by the root Purchase Order Vendor to prevent mixed-vendor PO selection.
- The selector Suitelet only lists purchase orders with at least one eligible receivable item line, so fully received or otherwise non-receivable POs are excluded before the user can choose them.
- PO-sourced child fields are made read-only/disabled by User Event `beforeLoad`.
- Line-level PO changes are not used to trigger item population.

Rationale:

- Header-level selection avoids accidental line-level repopulation.
- The child PO field remains visible for traceability and reporting.

## 2. Populate LCM Items From Selected PO Lines

When selected POs change, the item child sublist should reflect the selected PO item lines.

Implemented behavior:

- Client Script watches `custrecord_lcm_selected_pos` in `fieldChanged`.
- On change, the script calls a Suitelet to fetch PO item lines.
- The client clears the current `Items` sublist and rebuilds it from the selected PO lines.
- Each generated child line is populated with hidden vendor reference, PO, item, description, quantities, unit, rate, exchange rate, track checkbox default, and PO line key.

Current field mapping:

| Source | Target |
| --- | --- |
| PO internal ID | `custrecord_lcmitems_po` |
| PO header `entity` | `custrecord_lcmitems_vendor` |
| PO line item | `custrecord_lcmitems_item` |
| PO line memo/item text | `custrecord_lcmitems_description` |
| PO line unit | `custrecord_lcmitems_unit_type` |
| PO remaining receivable quantity | `custrecord_lcmitem_ex_receipt` |
| Default quantity to receive/bill | `custrecord_lcmitems_receipt` |
| Expected minus receipt quantity | `custrecord_lcmitems_quantity_remaining` |
| Derived `full`/`partial` status | `custrecord_lcmitems_bill_status` |
| PO transaction currency text | `custrecord_lcmitems_po_currency_text` |
| PO line exchange rate | `custrecord_lcmitems_exchange_rate` |
| PO line rate | `custrecord_lcmitems_po_rate` |
| PO rate x exchange rate x quantity receipt | `custrecord_lcmitems_po_value` |
| Generated PO line key | `custrecord_lcmitems_source_line_key` |
| Default unchecked | `custrecord_lcmitems_track_item` |

Implementation detail:

- Item rows are generated only for receivable PO item lines with positive open receipt quantity.
- `Quantity Receipt` is editable after generation and drives `Bill Status`, `Quantity Remaining`, converted `PO Value`, allocation quantity, and `Total Value`.
- The client recalculates derived values immediately in the sublist; `customscript_lcm_items_ue` repeats the calculation on save for inline edits, imports, and non-standard forms.
- `Quantity Bill` remains only as a hidden legacy field.
- PO uses the PO internal ID. NetSuite displays the transaction number (`tranid`) to users.

## 3. Delete/Rebuild Behavior Instead of Dedupe

Earlier dedupe logic was not reliable in the browser because NetSuite sublists can return mixed display text/internal values. The current requirement is simpler and deterministic: clear existing item lines and repopulate them.

Implemented behavior:

- Client-side: every header PO selection change clears all current `LCM Items` rows in the UI and rebuilds them from currently selected POs.
- Server-side: User Event `afterSubmit` reconciles persisted `LCM Items` by `PO Line Key` only when:
  - the root record is created,
  - the root record is copied, or
  - `custrecord_lcm_selected_pos` changes.
- Server-side sync does not run on ordinary edits when selected POs are unchanged, so later line-level fields are not wiped just because the root record is saved.

## 4. Remove Child Rows When PO Is Removed

When a user removes a PO from `Selected Purchase Orders`, item lines for that PO should be removed.

Implemented behavior:

- Because the client clears and rebuilds from the current selection, removed POs naturally disappear immediately from the UI.
- Because the User Event reconciles persisted rows when selected POs change, removed POs also disappear after save while matched rows keep non-PO-derived values such as `Track Item`, `Unit Landed Cost`, and `Total Unit Cost`.

## 5. Track Item Checkbox

The item child sublist needs a checkbox column for future line-level workflow/tracking.

Implemented behavior:

- Added `Track Item` checkbox field on `LCM Items`.
- Field ID: `custrecord_lcmitems_track_item`.
- Default value is unchecked for generated lines.
- SDF field block is placed first in `customrecord_lcmitems.xml`, before `PO`.

Open caveat:

- If NetSuite still displays `Track Item` at the end, the custom entry form/sublist layout may override custom record field order. In that case, the custom entry form must be imported/updated and its sublist field order adjusted.

## 6. Script Components

| Script | Script ID | File | Purpose |
| --- | --- | --- | --- |
| PO Lines Suitelet | `customscript_lcm_po_lines_sl` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_lines_suitelet.js` | Returns selected PO item lines to the Client Script as JSON. |
| Receivable PO Selector Suitelet | `customscript_lcm_po_selector_sl` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selector_suitelet.js` | Opens from the parent LCM form and lists only Purchase Orders with receivable open item lines for the selected Purchase Order Vendor. Applies checked IDs back to `custrecord_lcm_selected_pos`. |
| PO Selection Client Script | `customscript_lcm_po_selection_cs` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_client.js` | Watches header PO selection, refreshes generated item rows immediately in the UI, exposes form button handlers, and sources Landed Cost row defaults when Vendor/Cost Category mapping changes. The parent LCM deployment is deployed for page/field events, the parent User Event also attaches the module path for custom button functions, and the child Landed Cost deployment is deployed so child record edit/popup pages receive field change events. |
| PO Selection User Event | `customscript_lcm_po_selection_ue` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_user_event.js` | Attaches the client module, disables direct editing of the stored selected PO field and line-level PO field, adds selector/action buttons, blocks PO selection changes after accounting creation, and performs save-time safety sync when selected POs change. |
| LCM Items Recalculation User Event | `customscript_lcm_items_ue` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_items_user_event.js` | Recalculates `Quantity Remaining`, `Bill Status`, `PO Value`, and `Total Value` on item-row saves and rejects negative or over-expected receipt quantities. |
| Accounting Preview/Create Suitelet | `customscript_lcm_accounting_sl` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_accounting_suitelet.js` | Shows Bill/Journal validation preview and performs confirmed transaction creation. |
| Landed Cost Row Lock User Event | `customscript_lcm_landed_cost_lock_ue` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_landed_cost_lock_user_event.js` | Blocks edits to transaction-driving Landed Cost fields after a row creates accounting. |
| Cost Category Item Map User Event | `customscript_lcm_cost_item_map_ue` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_cost_item_map_user_event.js` | Names mapping rows from their native LC Cost Category, rejects inactive/missing item mappings, and blocks duplicate active mappings for the same category. |
| Shared Config | N/A module file | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_config.js` | Central record IDs, field IDs, sublist IDs, and script deployment IDs. |
| Shared Library | N/A module file | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_lib.js` | PO search, item line transformation, and persisted child row reconcile logic. |
| Accounting Library | N/A module file | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_accounting_lib.js` | Landed Cost validation, transaction grouping/creation, duplicate blocking, cost category item mapping, and item cost allocation. |

## 7. Current Deployment Notes

- Project root: `D:\netsuite\landed_cost_management`
- NetSuite account used during deployment: `9385847`
- SuiteCloud project type: Account Customization Project
- Deploy command: `npm run deploy`
- Validation command: `npm run validate`
- Main warnings currently accepted: script deployments use `<allroles>T</allroles>`, which covers internal roles only unless external role audience is added explicitly.

## 8. Known Notes and Cleanup Items

- `custrecord_lcmitems_po_line_key` exists on the parent record due to an early failed deployment. It is hidden, relabeled as `Unused PO Line Key`, and not used by scripts.
- The old `PO Currency` field (`custrecord_lcmitems_po_currency`) is a Currency amount field, not a Currency list/reference field, so it is hidden. The visible PO currency value is stored as text in `custrecord_lcmitems_po_currency_text`.
- PO item sync is now reconcile-by-key, not truncate-and-rebuild. Matched generated item rows keep user/system fields that are not sourced from the PO, including `Track Item`, editable `Quantity Receipt`, `Unit Landed Cost`, `Total Unit Cost`, and derived values.
- After any Landed Cost row has created accounting, changing the header selected PO list is blocked to protect posted transaction references and item-level allocation values. The `Select Receivable POs` button remains visible in edit mode and shows the lock reason instead of opening the selector.
- Account-specific Vendor Bill body field `Bill Type` is mapped as `custbody12`; LCM scripts always apply `LC Bill` when Vendor Bills are generated.
- Landed Cost rows require their own visible `Vendor Name`. Subsidiary, currency, and exchange rate default from that row vendor when possible.
- Users select `LC Cost Category` from active `LCM Cost Category Item Map` rows. Scripts derive the hidden native Cost Category and Bill Item references from that selected mapping.
- The client and child User Event source matching available defaults: Subsidiary, Currency, Exchange Rate, fixed hidden Bill Type, fixed hidden Bill Line Type, Expense Account compatibility data, Allocation Method, Cost Category, and Bill Item. Each field is applied independently so one unavailable/invalid account field does not block the remaining defaults.

## 9. Bill and Journal Creation

Landed Cost rows now drive accounting creation from the `Landed Cost` child sublist.

Implemented behavior:

- Added `customrecord_lcm_landed_cost` to the SDF project with fields for target type, line-level Vendor Name, fixed hidden LC Bill/item-line settings, mapped LC Cost Category selector, hidden native cost references, editable currency/exchange rate, location, memo, processing status, and created transaction references.
- Added root record buttons on saved/viewed LCM records:
  - `Create Bill`
  - `Create Journal`
- Button clicks open a Suitelet preview before any transaction is created.
- `Create Bill` processes uncreated Landed Cost rows marked `Bill`, grouped by line Vendor Name, subsidiary, currency, and exchange rate. One LCM record can therefore create multiple Vendor Bills for different vendors, currencies, or exchange-rate contexts.
- Within each Vendor Bill group, compatible Landed Cost rows merge into one Vendor Bill item line when Vendor, Subsidiary, Currency, Exchange Rate, LC Cost Category, LC Cost Item, and Allocation Method all match. Effective Date, Location, Department, and Class do not split the merge group; if they differ, the generated Bill line uses the first source row's values. The original Landed Cost rows remain separate and are all linked back to the created Bill.
- Generated Vendor Bills set body field `custbody12` to `LC Bill`.
- Generated Vendor Bills set Bill `Landed Cost > Cost Allocation Method` from the Landed Cost row `Allocation Method`; the LCM default is `Value`.
- Bill rows always create Vendor Bill `item` lines. The old `Bill Line Type` field is hidden and fixed to `Item`.
- Merged Vendor Bill item lines use quantity `1`, summed amount as rate/amount, the mapped LC Cost Item, the shared LC Cost Category, and distinct row memos joined together as the description.
- Vendor Bill item lines set NetSuite item-line `Landed Cost Category` from the Landed Cost row `Cost Category`. Tagging is unconditional: it is what makes the generated Bill selectable later as an `Other Transaction` landed cost source on the Item Receipt/GRN.
- The Bill `Landed Cost` subtab per-category `Source`/`Amount` summary is only written when the generated Bill also carries inventory item lines to absorb the cost. A pure freight/duty/insurance Bill has none, so only line tagging plus `Cost Allocation Method` apply there.
- Both landed cost writes are evaluated after the Bill lines are added. A prior build read the item sublist before adding any line, so a newly created Bill always looked empty and no landed cost was assigned.
- NetSuite prerequisites for line tagging to take effect. All three must hold, otherwise the Bill still saves and the script logs an audit entry naming the Landed Cost row:
  - Vendor Bill lines are item lines. NetSuite `expense` lines cannot carry a Landed Cost Category.
  - `Bill Item` is a non-inventory/service/other-charge item. Inventory items are allocation targets, not cost carriers.
  - `Cost Category` is a Cost Category whose type is `Landed Cost`, and the `Landed Cost` feature is enabled at Setup > Company > Enable Features > Items & Inventory.
- `Create Journal` processes uncreated Landed Cost rows marked `Journal`, grouped by subsidiary and currency, and creates balanced Journal Entries from fixed account constants in `lcm_po_selection_config.js`. Current temporary constants are debit account `1` and credit account `2`; if either account is rejected by NetSuite, the script falls back through active account candidates and uses the first account accepted by the Journal line.
- If uncreated rows match a group that already has a created Vendor Bill or Journal Entry, the new rows are appended to that existing transaction instead of creating a second transaction.
- Already-created Landed Cost rows are skipped for line creation and protected from duplicate processing using processing status and created transaction ID.
- Created Vendor Bill or Journal Entry is stored back on each processed Landed Cost row in the visible `Created Transaction` field and hidden internal ID field.
- After successful Vendor Bill creation, scripts allocate the Bill landed-cost amount to checked `LCM Items` rows and update `Unit Landed Cost`, `Total Unit Cost`, and `Total Value`. Journal Entry amounts are not included in this item-cost recalculation.
- Landed Cost row amounts are converted to base currency with `Amount * Exchange Rate` before item allocation. PO rates are also converted with the PO exchange rate before value-based weighting and before `Total Unit Cost` is calculated.
- Allocation runs once per confirmed create action across all created groups, instead of rewriting every tracked item once per group.
- Created Landed Cost rows are locked from edits to transaction-driving fields by a child User Event.
- Selecting a mapped Landed Cost Category attempts to default `Allocation Method` from the mapped native NetSuite landed cost category metadata, falling back to `Value` if the account-specific native field is not readable.
- The root form has `Select All Track Items` in edit/create/copy mode to check all `Track Item` boxes on the Items sublist before creating accounting.

Allocation behavior:

- Only `LCM Items` rows with `Track Item` checked are allocation targets.
- If no `LCM Items` rows have `Track Item` checked, Vendor Bill creation is blocked before confirmation. Journal Entry creation does not require tracked item rows because Journal amounts are not included in `Unit Landed Cost` or `Total Unit Cost`.
- If the allocation method text contains quantity/qty, cost is allocated by quantity.
- If the allocation method text contains amount/value/rate, cost is allocated by PO value.
- Otherwise, cost is allocated equally across checked item rows.
- Exchange rate defaults to `1` when blank.

## 10. LC Cost Category Mapping and Auto-Sourcing

Selecting `LC Cost Category` (`custrecord_lcm_lcm_cost_item_map`, `customrecord_lcm_cost_item_map`) sources the hidden native references behind it.

- `LC Cost Item` (`custrecord_lcm_lcm_cost_item`, Item `-10`) is hidden and sourced from the selected `LCM Cost Category Item Map` row.
- `Cost Category` (`custrecord_lcm_lcm_cost_category`, native Cost Category `-155`) is hidden and sourced from the same mapping row so generated Vendor Bills can tag the item line.
- Mapping fields are `LC Cost Category` (`custrecord_lcm_ccim_category`, native Cost Category `-155`) and `LC Cost Item` (`custrecord_lcm_ccim_item`, Item `-10`).
- The mapped item must be active. It should be a non-inventory, service, or other-charge item suitable for Vendor Bill item lines.
- Active mapping rows are the user-facing options. Inactivating a mapping row removes that option from the Landed Cost sublist.
- `customscript_lcm_cost_item_map_ue` blocks duplicate active mappings for the same native category and names the mapping record from the selected native category for clean dropdown display.
- The previous exact-name item fallback is no longer part of the user-facing flow. Categories must be configured in `LCM Cost Category Item Map` before users can select them on Landed Cost rows.
- `normalizeValue` was called six times in `lcm_accounting_lib.js` without ever being defined, so every `getCostProfileDefaults` call raised `ReferenceError` at runtime. It is now defined.

### Where sourcing runs

| Path | Script | Runs when | Guarantee |
| --- | --- | --- | --- |
| Immediate | `lcm_po_selection_client.js` `fieldChanged`/`pageInit` | User changes mapped LC Cost Category on the form | Best effort. Depends on the client script loading and the field ids matching the rendered form. |
| Fallback | `lcm_landed_cost_lock_user_event.js` `beforeSubmit` | Create, edit, **and inline edit (XEDIT)** | Guaranteed. Runs regardless of form, field visibility, or whether the client script loaded. |

Inline edit was previously skipped entirely, so rows saved through inline edit or CSV import never received the hidden references. `XEDIT` now runs `sourceCostProfileRefs` only; the full vendor/parent sourcing stays off that path because an inline edit submits only the touched fields.

The client resolves the mapping through the `costItemMapDefaults` Suitelet action rather than its own `N/search`, so the immediate path and the save-time fallback cannot disagree. Old rows that still carry only the hidden native category can use `costProfileDefaults` to find the active mapping by category.

### Diagnostics

`DEBUG` in `lcm_po_selection_config.js` controls two verbose aids. Turn them off once field ids are confirmed.

- `logFormFields` - `beforeLoad` writes `LCM Landed Cost form field inventory` to the execution log for `customscript_lcm_landed_cost_lock_ue`, listing every `custrecord` field on the **rendered** form with its id, label, and type, split into ON FORM / NOT ON FORM. A custom entry form keeps its own layout and overrides the `displaytype` held in SDF, so the object XML cannot be trusted to describe the live form. This is how to find the real field id behind a label.
- `announceClientLoad` - `pageInit` logs `LCM client script loaded` and alerts if the configured LC Cost Category field id is absent from the form.

Every failure path now reports the selected mapping/category internal ID, selected text, mapping source, mapping record ID, and reason. Failures log at `error` level, successes at `audit`.

`N/log` in a **client** script writes to the browser console, not the NetSuite execution log. Client-side entries will never appear under the script deployment; open browser devtools for those.
