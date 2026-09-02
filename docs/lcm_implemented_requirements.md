# Landed Cost Management - Implemented Requirements

Last updated: 2026-09-01

This document tracks implemented behavior for the Landed Cost Management customization. Extend this file chunk by chunk as new requirements are added. For record and field references, see [lcm_record_reference_and_requirements.md](./lcm_record_reference_and_requirements.md).

## 1. Header-Level PO Selection

Users should select Purchase Orders once at the root/header level instead of choosing PO independently on each item child line.

Implemented behavior:

- Added root field `Vendor` (`custrecord_lcm_vendor`) as the header vendor for PO selection and landed-cost accounting.
- Added root field `Selected Purchase Orders` (`custrecord_lcm_selected_pos`) as a multi-select Purchase Order field.
- The root `Subsidiary` field (`custrecord_lcm_subsidiary`) is sourced from the selected vendor and disabled on the form by User Event `beforeLoad`.
- The existing child line `PO` field remains as a reference field on `LCM Items`.
- PO selection is filtered and validated by the root vendor to prevent mixed-vendor LCM records.
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
| PO line quantity | `custrecord_lcmitem_ex_receipt` |
| PO line quantity received | `custrecord_lcmitems_receipt` |
| Quantity minus received | `custrecord_lcmitems_quantity_remaining` |
| PO line quantity billed | `custrecord_lcmitems_quantity_bill` |
| PO line exchange rate | `custrecord_lcmitems_exchange_rate` |
| PO line rate | `custrecord_lcmitems_po_rate` |
| Generated PO line key | `custrecord_lcmitems_source_line_key` |
| Default unchecked | `custrecord_lcmitems_track_item` |

Implementation detail:

- Vendor is stored as a hidden compatibility/reference value; users select vendor once on the parent record.
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
| PO Selection Client Script | `customscript_lcm_po_selection_cs` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_client.js` | Watches header PO selection, refreshes generated item rows immediately in the UI, exposes form button handlers, and sources Landed Cost row defaults when Vendor/Cost Category changes. The parent LCM deployment is deployed for page/field events, the parent User Event also attaches the module path for custom button functions, and the child Landed Cost deployment is deployed so child record edit/popup pages receive field change events. |
| PO Selection User Event | `customscript_lcm_po_selection_ue` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_user_event.js` | Attaches the client module, disables line-level PO field, adds buttons, blocks PO selection changes after accounting creation, and performs save-time safety sync when selected POs change. |
| Accounting Preview/Create Suitelet | `customscript_lcm_accounting_sl` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_accounting_suitelet.js` | Shows Bill/Journal validation preview and performs confirmed transaction creation. |
| Landed Cost Row Lock User Event | `customscript_lcm_landed_cost_lock_ue` | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_landed_cost_lock_user_event.js` | Blocks edits to transaction-driving Landed Cost fields after a row creates accounting. |
| Shared Config | N/A module file | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_config.js` | Central record IDs, field IDs, sublist IDs, and script deployment IDs. |
| Shared Library | N/A module file | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_lib.js` | PO search, item line transformation, and persisted child row reconcile logic. |
| Accounting Library | N/A module file | `src/FileCabinet/SuiteScripts/landed-cost-management/lcm_accounting_lib.js` | Landed Cost validation, transaction grouping/creation, duplicate blocking, and item cost allocation. |

## 7. Current Deployment Notes

- Project root: `D:\netsuite\landed_cost_management`
- NetSuite account used during deployment: `9385847`
- SuiteCloud project type: Account Customization Project
- Deploy command: `npm run deploy`
- Validation command: `npm run validate`
- Main warnings currently accepted: script deployments use `<allroles>T</allroles>`, which covers internal roles only unless external role audience is added explicitly.

## 8. Known Notes and Cleanup Items

- `custrecord_lcmitems_po_line_key` exists on the parent record due to an early failed deployment. It is hidden, relabeled as `Unused PO Line Key`, and not used by scripts.
- `PO Currency` on `LCM Items` is a Currency amount field, not a Currency list/reference field. Do not map PO currency internal ID into it unless the field is changed or a new reference field is added.
- PO item sync is now reconcile-by-key, not truncate-and-rebuild. Matched generated item rows keep user/system fields that are not sourced from the PO, including `Track Item`, `Unit Landed Cost`, and `Total Unit Cost`.
- After any Landed Cost row has created accounting, changing the header selected PO list is blocked to protect posted transaction references and item-level allocation values.
- Account-specific Vendor Bill body field `Bill Type` is mapped as `custbody12`; LCM scripts source it from SDF-managed child field `custrecord_lcm_lcm_cost_bill_type`.
- Landed Cost rows inherit Vendor and Subsidiary from the parent record. The line-level Vendor and Subsidiary fields are hidden and retained only as compatibility/reference fields.
- Users select `LC Cost Profile`; scripts map that profile to hidden native Cost Category and Bill Item references. The profile list values currently assume matching NetSuite native Cost Category and Item names such as `LC - Freight`.
- The client and child User Event source matching available defaults: Subsidiary, Currency, Exchange Rate, Bill Type, Expense Account, Allocation Method, Cost Category, and Bill Item. Each field is applied independently so one unavailable/invalid account field does not block the remaining defaults.

## 9. Bill and Journal Creation

Landed Cost rows now drive accounting creation from the `Landed Cost` child sublist.

Implemented behavior:

- Added `customrecord_lcm_landed_cost` to the SDF project with fields for target type, hidden Bill Type, LC Cost Profile, hidden vendor/subsidiary/native cost references, currency, Bill line type, hidden expense details, classifications, memo, processing status, and created transaction references.
- Added root record buttons on saved/viewed LCM records:
  - `Create Bill`
  - `Create Journal`
- Button clicks open a Suitelet preview before any transaction is created.
- `Create Bill` processes uncreated Landed Cost rows marked `Bill`, grouped by vendor, subsidiary, Bill Type, and currency. NetSuite sources transaction currency from the selected vendor/subsidiary instead of forcing the Landed Cost currency field.
- Generated Vendor Bills set body field `custbody12` from the Landed Cost row `Bill Type` field.
- Generated Vendor Bills set Bill `Landed Cost > Cost Allocation Method` from the Landed Cost row `Allocation Method`; the LCM default is `Value`.
- Bill rows can create either Vendor Bill `expense` lines or `item` lines based on `Bill Line Type`.
- Vendor Bill item lines set NetSuite item-line `Landed Cost Category` from the Landed Cost row `Cost Category`. Tagging is unconditional: it is what makes the generated Bill selectable later as an `Other Transaction` landed cost source on the Item Receipt/GRN.
- The Bill `Landed Cost` subtab per-category `Source`/`Amount` summary is only written when the generated Bill also carries inventory item lines to absorb the cost. A pure freight/duty/insurance Bill has none, so only line tagging plus `Cost Allocation Method` apply there.
- Both landed cost writes are evaluated after the Bill lines are added. A prior build read the item sublist before adding any line, so a newly created Bill always looked empty and no landed cost was assigned.
- NetSuite prerequisites for line tagging to take effect. All three must hold, otherwise the Bill still saves and the script logs an audit entry naming the Landed Cost row:
  - `Bill Line Type` is `Item`. NetSuite `expense` lines cannot carry a Landed Cost Category.
  - `Bill Item` is a non-inventory/service/other-charge item. Inventory items are allocation targets, not cost carriers.
  - `Cost Category` is a Cost Category whose type is `Landed Cost`, and the `Landed Cost` feature is enabled at Setup > Company > Enable Features > Items & Inventory.
- `Create Journal` processes uncreated Landed Cost rows marked `Journal`, grouped by subsidiary and currency, and creates balanced Journal Entries from fixed account constants in `lcm_po_selection_config.js`. Current temporary constants are debit account `1` and credit account `2`; replace them with approved LCM posting accounts before production Journal use.
- If uncreated rows match a group that already has a created Vendor Bill or Journal Entry, the new rows are appended to that existing transaction instead of creating a second transaction.
- Already-created Landed Cost rows are skipped for line creation and protected from duplicate processing using processing status and created transaction ID.
- Created Vendor Bill or Journal Entry is stored back on each processed Landed Cost row in the visible `Created Transaction` field and hidden internal ID field.
- After successful creation, scripts allocate the created cost amount to checked `LCM Items` rows and update `Unit Landed Cost` and `Total Unit Cost`.
- Allocation runs once per confirmed create action across all created groups, instead of rewriting every tracked item once per group.
- Created Landed Cost rows are locked from edits to transaction-driving fields by a child User Event.
- Selecting a Landed Cost Category attempts to default `Allocation Method` from NetSuite landed cost category metadata, falling back to `Value` if the account-specific native field is not readable.
- The root form has `Select All Track Items` in edit/create/copy mode to check all `Track Item` boxes on the Items sublist before creating accounting.

Allocation behavior:

- Only `LCM Items` rows with `Track Item` checked are allocation targets.
- If no `LCM Items` rows have `Track Item` checked, accounting creation is blocked before confirmation.
- If the allocation method text contains quantity/qty, cost is allocated by quantity.
- If the allocation method text contains amount/value/rate, cost is allocated by PO value.
- Otherwise, cost is allocated equally across checked item rows.
- Exchange rate defaults to `1` when blank.

## 10. LC Cost Profile Auto-Sourcing

Selecting `LC Cost Profile` (`custrecord_lcm_lcm_cost_profile`, native Landed Cost Category list `-155`) sources the hidden references behind it.

- `LC Cost Item` (`custrecord_lcm_lcm_cost_item`, Item `-10`) is matched to an **active** item whose Name/Number (`itemid`) or Display Name (`displayname`) equals the profile text exactly. Example: profile `LC Advanced Income Tax` resolves to item `1933`.
- `Cost Category` (`custrecord_lcm_lcm_cost_category`) stores the selected category so generated Vendor Bills can tag the item line.
- Item search filters on `itemid` then `displayname`. `name` is **not** a searchable field on an item search and raised `invalid field: name` on every lookup; it has been removed.
- A subitem's `itemid` includes its parent (`Parent : Child`), so a subitem will not match on Name/Number. Give it a Display Name equal to the profile text, or use a top-level item.
- `normalizeValue` was called six times in `lcm_accounting_lib.js` without ever being defined, so every `getCostProfileDefaults` call raised `ReferenceError` at runtime. It is now defined.

### Where sourcing runs

| Path | Script | Runs when | Guarantee |
| --- | --- | --- | --- |
| Immediate | `lcm_po_selection_client.js` `fieldChanged`/`pageInit` | User changes LC Cost Profile on the form | Best effort. Depends on the client script loading and the field ids matching the rendered form. |
| Fallback | `lcm_landed_cost_lock_user_event.js` `beforeSubmit` | Create, edit, **and inline edit (XEDIT)** | Guaranteed. Runs regardless of form, field visibility, or whether the client script loaded. |

Inline edit was previously skipped entirely, so rows saved through inline edit or CSV import never received the hidden references. `XEDIT` now runs `sourceCostProfileRefs` only; the full vendor/parent sourcing stays off that path because an inline edit submits only the touched fields.

The client resolves the item through the `costProfileDefaults` Suitelet action rather than its own `N/search`, so the immediate path and the save-time fallback cannot disagree.

### Diagnostics

`DEBUG` in `lcm_po_selection_config.js` controls two verbose aids. Turn them off once field ids are confirmed.

- `logFormFields` - `beforeLoad` writes `LCM Landed Cost form field inventory` to the execution log for `customscript_lcm_landed_cost_lock_ue`, listing every `custrecord` field on the **rendered** form with its id, label, and type, split into ON FORM / NOT ON FORM. A custom entry form keeps its own layout and overrides the `displaytype` held in SDF, so the object XML cannot be trusted to describe the live form. This is how to find the real field id behind a label.
- `announceClientLoad` - `pageInit` logs `LCM client script loaded` and alerts if the configured LC Cost Profile field id is absent from the form.

Every failure path now reports the selected category internal ID, the selected category text, the attempted item name, and the reason. Failures log at `error` level, successes at `audit`.

`N/log` in a **client** script writes to the browser console, not the NetSuite execution log. Client-side entries will never appear under the script deployment; open browser devtools for those.
