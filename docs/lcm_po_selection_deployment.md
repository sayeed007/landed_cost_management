# Landed Cost Management PO Selection SuiteScript

## Requirement Implemented

Move Purchase Order Vendor and PO selection to the `Landed Cost Management` header. Users choose POs through the `Select Receivable POs` Suitelet button, which only lists Purchase Orders that match the header Purchase Order Vendor and have at least one receivable open item line. The selected IDs are stored in the header PO multi-select. When that selection changes, the `LCM Items` subtab is refreshed from selected receivable PO item lines. Removing a PO from the header selection removes/deletes the generated item rows tied to that PO.

## NetSuite Records Found

- Parent: `CUSTOMRECORD_LANDED_COST_MANAGEMENT`, internal type ID `2517`
- Items child: `CUSTOMRECORD_LCMITEMS`, internal type ID `2518`
- Parent link on child: `CUSTRECORD_LCM_LCM_HIDDEN_LCM_ITEM`
- Existing child PO field: `CUSTRECORD_LCMITEMS_PO`

## Required Custom Fields

Create these before deploying the scripts:

1. Parent field on `Landed Cost Management`
   - Label: `Purchase Order Vendor`
   - ID: `custrecord_lcm_vendor`
   - Type: `List/Record`
   - List/Record: `Vendor`
   - Show on form header.

2. Parent field on `Landed Cost Management`
   - Label: `Selected Purchase Orders`
   - ID: `custrecord_lcm_selected_pos`
   - Type: `Multiple Select`
   - List/Record: `Purchase Order`
   - Filter: `Purchase Order Vendor` equals `custrecord_lcm_vendor`.
   - Show on form header as a read-only stored selection field.
   - Users populate this through the `Select Receivable POs` button instead of directly opening the native multi-select options.

3. Child field on `LCM Items`
   - Label: `PO Line Key`
   - ID: `custrecord_lcmitems_source_line_key`
   - Type: `Free-Form Text`
   - Store Value: checked
   - Display Type: hidden/disabled
   - Purpose: duplicate guard using `parent LCM + PO + PO line unique key`.

4. Child field on `LCM Items`
   - Label: `Track Item`
   - ID: `custrecord_lcmitems_track_item`
   - Type: `Check Box`
   - Purpose: line-level flag for future processing work.

5. Child field on `Landed Cost`
   - Label: `LC Cost Category`
   - ID: `custrecord_lcm_lcm_cost_item_map`
   - Type: `List/Record`
   - List/Record: `LCM Cost Category Item Map` (`customrecord_lcm_cost_item_map`)
   - Purpose: visible mapped-category selector. Active mapping rows are the only user-facing category options.

6. Child field on `LCM Items`
   - Label: `Receive Status`
   - ID: `custrecord_lcmitems_bill_status`
   - Type: `Free-Form Text`
   - Purpose: `full` when Expected Quantity Receipt equals Quantity Receipt; otherwise `partial`.

7. Child field on `LCM Items`
   - Label: `PO Value`
   - ID: `custrecord_lcmitems_po_value`
   - Type: `Currency`
   - Purpose: PO Rate multiplied by PO Exchange Rate and Quantity Receipt.

8. Child field on `LCM Items`
   - Label: `Total Value`
   - ID: `custrecord_lcmitems_total_value`
   - Type: `Currency`
   - Purpose: Total Unit Cost multiplied by Quantity Receipt.

9. Child field on `LCM Items`
   - Label: `PO Currency`
   - ID: `custrecord_lcmitems_po_currency_text`
   - Type: `Free-Form Text`
   - Purpose: visible PO transaction currency text.

10. Child field on `Landed Cost`
   - Label: `Vendor Name`
   - ID: `custrecord_lcm_lcm_vendor`
   - Type: `List/Record`
   - List/Record: `Vendor`
   - Mandatory: checked
   - Purpose: row-level landed-cost vendor used to group and create one or more Vendor Bills from one LCM record.

11. Custom record `LCM Cost Category Item Map`
   - ID: `customrecord_lcm_cost_item_map`
   - Purpose: explicit admin mapping from LC Cost Category to LC Cost Item.
   - Include Name: enabled; mapping User Event auto-names each row from the selected category.
   - Field: `custrecord_lcm_ccim_category` (`LC Cost Category`, native Cost Category `-155`, mandatory)
   - Field: `custrecord_lcm_ccim_item` (`LC Cost Item`, Item `-10`, mandatory)
   - Field: `custrecord_lcm_ccim_memo` (`Memo`, optional)

## Files

- `lcm_po_selection_config.js`
- `lcm_po_selection_lib.js`
- `lcm_po_lines_suitelet.js`
- `lcm_po_selector_suitelet.js`
- `lcm_po_selection_client.js`
- `lcm_po_selection_user_event.js`
- `lcm_items_user_event.js`
- `lcm_accounting_lib.js`
- `lcm_accounting_suitelet.js`
- `lcm_cost_item_map_user_event.js`

Upload all files into the same File Cabinet folder so the relative module imports resolve.

## Script Records

1. Suitelet
   - File: `lcm_po_lines_suitelet.js`
   - Script ID: `customscript_lcm_po_lines_sl`
   - Deployment ID: `customdeploy_lcm_po_lines_sl`
   - Audience: same users who edit Landed Cost Management.

2. Suitelet
   - File: `lcm_po_selector_suitelet.js`
   - Script ID: `customscript_lcm_po_selector_sl`
   - Deployment ID: `customdeploy_lcm_po_selector_sl`
   - Audience: same users who edit Landed Cost Management.
   - Purpose: lists only eligible receivable POs for the current Purchase Order Vendor and applies the checked selection back to `custrecord_lcm_selected_pos`.

3. Client Script
   - File: `lcm_po_selection_client.js`
   - Attach to the `Landed Cost Management` custom record form.
   - Trigger: `lineInit` on the Landed Cost sublist and `fieldChanged` on `custrecord_lcm_vendor`, `custrecord_lcm_selected_pos`, `custrecord_lcmitems_receipt`, `custrecord_lcm_lcm_vendor`, `custrecord_lcm_lcm_currency`, and `custrecord_lcm_lcm_cost_item_map`.
   - Button handler: `openReceivablePoSelector()` opens the selector Suitelet.
   - Popup callback: `applyReceivablePoSelection()` writes selected IDs to `custrecord_lcm_selected_pos` and refreshes the item sublist.

4. User Event
   - File: `lcm_po_selection_user_event.js`
   - Deploy on `CUSTOMRECORD_LANDED_COST_MANAGEMENT`.
   - `beforeLoad`: disables sourced parent/sublist fields as read-only references and adds `Select Receivable POs`.
   - `afterSubmit`: server-side safety sync and deletion for removed POs.

5. User Event
   - File: `lcm_items_user_event.js`
   - Deploy on `CUSTOMRECORD_LCMITEMS`.
   - `beforeSubmit`: recalculates item derived fields and validates editable `Quantity Receipt`.

6. User Event
   - File: `lcm_cost_item_map_user_event.js`
   - Deploy on `CUSTOMRECORD_LCM_COST_ITEM_MAP`.
   - `beforeSubmit`: auto-names mapping rows, validates active item selection, and blocks duplicate active mappings for the same LC Cost Category.

## Behavior

On header Purchase Order Vendor/PO change:

- Source parent Subsidiary from the selected Purchase Order Vendor.
- Open the `Select Receivable POs` picker from the parent form.
- List only Purchase Orders that have at least one receivable item line with positive open receipt quantity.
- Apply checked eligible PO IDs into the stored `Selected Purchase Orders` field.
- Validate selected POs against the header Purchase Order Vendor.
- If any Landed Cost row already created a Bill or Journal Entry, keep the selector button visible but show the lock reason instead of opening the picker.
- Fetch selected PO item lines through the Suitelet.
- Exclude closed/non-receivable PO lines and lines whose open receipt quantity is zero or below.
- Remove existing item subtab rows whose PO is no longer selected.
- Add missing item rows for newly selected PO lines.
- Keep existing rows for still-selected POs by matching `PO Line Key`.
- Keep PO-derived fields as read-only references, except `Quantity Receipt`, which remains editable.
- Recalculate `Receive Status`, `Quantity Remaining`, `PO Value`, and `Total Value` when `Quantity Receipt` changes.
- `PO Value` is recalculated in base currency as `PO Rate * PO Exchange Rate * Quantity Receipt`.
- `Total Value` is recalculated in base currency as `Total Unit Cost * Quantity Receipt`.

On Landed Cost row Vendor Name change:

- Source subsidiary, currency, exchange rate, fixed hidden Bill Type, and fixed hidden Bill Line Type from the selected row vendor where available.
- Rename Target Type to Document Type and default it to Bill.
- Keep Currency and Exchange Rate editable after defaulting; refresh Exchange Rate when Currency changes.
- Make Effective Date mandatory and default it to today's date.
- Default Location from the first selected PO's Location when available.

On Landed Cost row LC Cost Category change:

- The visible selector is `custrecord_lcm_lcm_cost_item_map`, so only active `LCM Cost Category Item Map` rows appear as options.
- Source hidden native `Cost Category` from the selected mapping row.
- Resolve hidden `LC Cost Item` from the selected mapping row.
- If the selected mapping is inactive, missing, or points to an inactive item, leave `LC Cost Item` blank and report the mapping reason.

On Create Bill:

- Group Vendor Bills by landed-cost Vendor Name, Subsidiary, Currency, and Exchange Rate.
- Within each Vendor Bill group, merge rows into one Vendor Bill item line when Vendor, Subsidiary, Currency, Exchange Rate, LC Cost Category, LC Cost Item, and Allocation Method all match. Effective Date, Location, Department, and Class do not split the merge group; if they differ, the generated Bill line uses the first source row's values. When appending to an existing generated Vendor Bill, matching existing cost lines are consolidated before the new amount is added. Recalculate Landed Cost remains an allocation repair action and does not rewrite an already-created Vendor Bill.
- Use one merged item line with quantity `1`, summed amount as rate/amount, mapped LC Cost Item, shared LC Cost Category, and distinct row memos joined as the description.
- Keep all original Landed Cost rows separate on the LCM record and mark each source row `Created` with the same generated Bill reference.
- Mark `Cost Allocated In GRN` only after item-level allocation succeeds.
- After confirmation, show a `Back to Landed Cost Management` link to return to the source LCM record.

On Recalculate Landed Cost:

- Do not create or append Vendor Bills.
- Recalculate item landed cost fresh from all created Bill-type Landed Cost rows on the LCM record.
- Update tracked `LCM Items` rows with recalculated `Unit Landed Cost`, `Total Unit Cost`, and `Total Value`.
- Mark all created Bill-type Landed Cost rows as `Cost Allocated In GRN` only after item-level allocation succeeds.
- Use this to repair created-but-unallocated rows when a prior create attempt partially failed and there are no new Bills to create.

On save:

- Re-read selected header POs.
- Delete persisted `LCM Items` rows for deselected POs.
- Create missing `LCM Items` rows for selected PO lines.
- Update matched PO-derived fields by `custrecord_lcmitems_source_line_key`.
- If a just-saved inline child row is missing that hidden key, match it once by PO + Item, write the generated key, and preserve the user's `Track Item` selection.
- Preserve matched row values that are not sourced from the PO, including `Track Item`, editable `Quantity Receipt`, `Unit Landed Cost`, `Total Unit Cost`, and derived values.
- Avoid duplicates using `custrecord_lcmitems_source_line_key`.
- On each `LCM Items` row save, validate that `Quantity Receipt` is not negative or greater than `Expected Quantity Receipt`, then recalculate `Receive Status`, `Quantity Remaining`, `PO Value`, and `Total Value`.

## Field Mapping

- PO -> `custrecord_lcmitems_po`
- Item -> `custrecord_lcmitems_item`
- Memo/Item text -> `custrecord_lcmitems_description`
- Vendor -> `custrecord_lcmitems_vendor` hidden compatibility/reference field
- PO open receipt quantity -> `custrecord_lcmitem_ex_receipt`
- Default open receipt quantity -> `custrecord_lcmitems_receipt`
- Expected minus receipt quantity -> `custrecord_lcmitems_quantity_remaining`
- Derived full/partial status -> `custrecord_lcmitems_bill_status`
- Unit -> `custrecord_lcmitems_unit_type`
- PO rate -> `custrecord_lcmitems_po_rate`
- PO currency text -> `custrecord_lcmitems_po_currency_text`
- PO rate x PO exchange rate x receipt quantity -> `custrecord_lcmitems_po_value`
- Total unit cost x receipt quantity -> `custrecord_lcmitems_total_value`
- Exchange rate -> `custrecord_lcmitems_exchange_rate`
- Generated key -> `custrecord_lcmitems_source_line_key`

## Notes

The original `PO Currency` field (`custrecord_lcmitems_po_currency`) is configured as a Currency amount field, not a List/Record Currency field. It is hidden as legacy metadata. Visible PO currency text is stored in `custrecord_lcmitems_po_currency_text`.

If the child sublist is not editable through `currentRecord`, keep the User Event deployed; the item lines will still be corrected after save, but the immediate on-change UX will need a custom Suitelet form or an editable child-record sublist configuration.
