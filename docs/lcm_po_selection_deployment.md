# Landed Cost Management PO Selection SuiteScript

## Requirement Implemented

Move Vendor and PO selection to the `Landed Cost Management` header. When the header PO multi-select changes, the `LCM Items` subtab is refreshed from selected PO item lines that match the header Vendor. Removing a PO from the header selection removes/deletes the generated item rows tied to that PO.

## NetSuite Records Found

- Parent: `CUSTOMRECORD_LANDED_COST_MANAGEMENT`, internal type ID `2517`
- Items child: `CUSTOMRECORD_LCMITEMS`, internal type ID `2518`
- Parent link on child: `CUSTRECORD_LCM_LCM_HIDDEN_LCM_ITEM`
- Existing child PO field: `CUSTRECORD_LCMITEMS_PO`

## Required Custom Fields

Create these before deploying the scripts:

1. Parent field on `Landed Cost Management`
   - Label: `Vendor`
   - ID: `custrecord_lcm_vendor`
   - Type: `List/Record`
   - List/Record: `Vendor`
   - Show on form header.

2. Parent field on `Landed Cost Management`
   - Label: `Selected Purchase Orders`
   - ID: `custrecord_lcm_selected_pos`
   - Type: `Multiple Select`
   - List/Record: `Purchase Order`
   - Filter: `Vendor` equals `custrecord_lcm_vendor`.
   - Show on form header.

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
   - Label: `LC Cost Profile`
   - ID: `custrecord_lcm_lcm_cost_profile`
   - Type: `List/Record`
   - List/Record: `LCM Cost Profile`
   - Purpose: visible LC-specific selector mapped by script to hidden native Cost Category and Bill Item references.

## Files

- `lcm_po_selection_config.js`
- `lcm_po_selection_lib.js`
- `lcm_po_lines_suitelet.js`
- `lcm_po_selection_client.js`
- `lcm_po_selection_user_event.js`

Upload all files into the same File Cabinet folder so the relative module imports resolve.

## Script Records

1. Suitelet
   - File: `lcm_po_lines_suitelet.js`
   - Script ID: `customscript_lcm_po_lines_sl`
   - Deployment ID: `customdeploy_lcm_po_lines_sl`
   - Audience: same users who edit Landed Cost Management.

2. Client Script
   - File: `lcm_po_selection_client.js`
   - Attach to the `Landed Cost Management` custom record form.
   - Trigger: `fieldChanged` on `custrecord_lcm_vendor`, `custrecord_lcm_selected_pos`, and `custrecord_lcm_lcm_cost_profile`.

3. User Event
   - File: `lcm_po_selection_user_event.js`
   - Deploy on `CUSTOMRECORD_LANDED_COST_MANAGEMENT`.
   - `beforeLoad`: disables sourced parent/sublist fields as read-only references.
   - `afterSubmit`: server-side safety sync and deletion for removed POs.

## Behavior

On header Vendor/PO change:

- Source parent Subsidiary from the selected Vendor.
- Filter/validate selected POs against the header Vendor.
- Fetch selected PO item lines through the Suitelet.
- Remove existing item subtab rows whose PO is no longer selected.
- Add missing item rows for newly selected PO lines.
- Keep existing rows for still-selected POs by matching `PO Line Key`.
- Keep PO-derived fields as read-only references.

On save:

- Re-read selected header POs.
- Delete persisted `LCM Items` rows for deselected POs.
- Create missing `LCM Items` rows for selected PO lines.
- Update matched PO-derived fields by `custrecord_lcmitems_source_line_key`.
- If a just-saved inline child row is missing that hidden key, match it once by PO + Item, write the generated key, and preserve the user's `Track Item` selection.
- Preserve matched row values that are not sourced from the PO, including `Track Item`, `Unit Landed Cost`, and `Total Unit Cost`.
- Avoid duplicates using `custrecord_lcmitems_source_line_key`.

## Field Mapping

- PO -> `custrecord_lcmitems_po`
- Item -> `custrecord_lcmitems_item`
- Memo/Item text -> `custrecord_lcmitems_description`
- Vendor -> `custrecord_lcmitems_vendor` hidden compatibility/reference field
- PO quantity received -> `custrecord_lcmitems_receipt`
- PO quantity -> `custrecord_lcmitem_ex_receipt`
- PO quantity minus received -> `custrecord_lcmitems_quantity_remaining`
- PO quantity billed -> `custrecord_lcmitems_quantity_bill`
- Unit -> `custrecord_lcmitems_unit_type`
- PO rate -> `custrecord_lcmitems_po_rate`
- Exchange rate -> `custrecord_lcmitems_exchange_rate`
- Generated key -> `custrecord_lcmitems_source_line_key`

## Notes

The existing `PO Currency` field is configured as a Currency amount field, not a List/Record Currency field, so the scripts do not populate it with the PO currency internal ID. If this should show the PO currency, change/add a List/Record Currency field and add it to the mapping.

If the child sublist is not editable through `currentRecord`, keep the User Event deployed; the item lines will still be corrected after save, but the immediate on-change UX will need a custom Suitelet form or an editable child-record sublist configuration.
