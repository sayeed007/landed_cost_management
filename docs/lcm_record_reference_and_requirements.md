# Landed Cost Management - Record Reference

Last updated: 2026-09-22

This document is the working record and field reference for the Landed Cost Management customization. It captures the current NetSuite custom records, field usage, and parent-child relationships. For implemented behavior and requirement chunks, see [lcm_implemented_requirements.md](./lcm_implemented_requirements.md).

## 1. Root Custom Record

| Property | Value |
| --- | --- |
| Record name | Landed Cost Management |
| Script ID | `customrecord_landed_cost_management` |
| Internal type ID | `2517` |
| SDF object | `src/Objects/customrecord_landed_cost_management.xml` |
| Purpose | Header/root record for landed cost processing. It stores LC, port, incoterm, selected PO context, and owns child item and landed-cost rows. Shipment numbering is record auto-numbered. |
| UI tabs | `Items`, `Landed Cost`, plus standard notes/files tabs |
| Main customization added | Header-level receivable PO selector supports the generated `LCM Items` child sublist. |

### Root Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Purchase Order Vendor | `custrecord_lcm_vendor` | Select, Vendor (`-3`) | Header vendor used only for selected PO filtering and validation. Landed Cost row `Vendor Name` drives generated Vendor Bills. |
| Subsidiary | `custrecord_lcm_subsidiary` | Select, `-117` | Subsidiary context sourced from Vendor and disabled on the form. |
| Selected Purchase Orders | `custrecord_lcm_selected_pos` | Multi-select, Purchase Order (`-30`) | Stored PO selection field. The form makes it read-only and users populate it through the `Select Receivable POs` Suitelet, which only lists POs that have at least one receivable open item line for the selected Purchase Order Vendor. Changing this field regenerates the `LCM Items` child sublist from selected PO item lines. |
| Shipment Status | `custrecord_lcm_shipment_status` | Select, `customlist2527` | Dynamic shipment state: `To Be Shipped` before any Landed Cost row exists; `In Transit` until every Bill row is allocated and every positive-quantity LCM Item is linked to a generated Item Receipt; then `Partially Received` or `Received` from the Items tab Receive Status values. |
| Shipment Number | `custrecord_lcm_shipment_number` | Text | Legacy hidden shipment number text field. Shipment numbering now uses the custom record auto-number/name with `SHIP-` prefix and 5 minimum digits. |
| Shipment Date | `custrecord_lcm_shipment_date` | Date | Shipment date for the landed cost record. |
| LC Loan Number | `custrecord_lcm_lc_laon_number` | Text | LC loan number. Existing spelling in NetSuite is `laon`. |
| Master PI Number | `custrecord_lcm_master_pi_number` | Text | Master PI reference. |
| LC Number | `custrecord_lcm_lc_number` | Text | Letter of Credit number. |
| LC Value | `custrecord_lcm_lc_value` | Currency | LC value amount. |
| LC Margin Amount | `custrecord_lcm_lc_margin_amount` | Currency | LC margin amount. |
| LC Type | `custrecord_lcm_lc_type` | Select, `customlist_lc_type` | LC type classification. |
| LC Status | `custrecord_lcm_lc_status` | Select, `customlist_lc_status` | LC status classification. |
| Loading Port | `custrecord_lcm_loading_port` | Select, `customlist_wmsse_ports` | Loading port. |
| Shipment Mode | `custrecord_lcm_shipment_mode` | Select, `-192` | Shipment mode. |
| External Document No. | `custrecord_lcm_external_doc_no` | Text | External document reference. |
| Incoterm | `custrecord_lcm_incoterm` | Select, `-324` | Incoterm selection. |
| LC Open Date | `custrecord_lcm_lc_open_date` | Date | LC opening date. |
| LC Expire Date | `custrecord_lcm_lc_expire_date` | Date | LC expiry date. |
| LC Amendment Date | `custrecord_lcm_lc_amendment_date` | Date | LC amendment date. |
| LC Amendment No. | `custrecord_lcm_lc_amendment_no` | Text | LC amendment number. |
| LC Cover Note No. | `custrecord_lc_cover_note_no` | Text | LC cover note number. |
| IRC NO. | `custrecord_lcm_irc_no` | Text | IRC reference number. |
| Air/ Vassel Name | `custrecord_lcm_air_vassel_name` | Text | Vessel/air carrier name. Existing label spelling is `Vassel`. |
| Unused PO Line Key | `custrecord_lcmitems_po_line_key` | Hidden text | Accidental parent-scoped field from an early deployment attempt. It is hidden and not used by scripts. Correct child line key is `custrecord_lcmitems_source_line_key`. |

## 2. Child Custom Record: LCM Items

| Property | Value |
| --- | --- |
| Record name | LCM Items |
| Script ID | `customrecord_lcmitems` |
| Internal type ID | `2518` |
| SDF object | `src/Objects/customrecord_lcmitems.xml` |
| Parent link | `custrecord_lcm_lcm_hidden_lcm_item` |
| Parent subtab | `Items` tab on Landed Cost Management |
| Purpose | Generated item-level rows from selected receivable Purchase Order item lines that still have quantity open to receive. These rows provide the item, PO, editable receipt quantity, rate, landed-cost allocation context, and the generated Item Receipt (GRN) audit link. |

### LCM Items Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Track Item | `custrecord_lcmitems_track_item` | Checkbox | Line-level marker for future processing. Placed first in the field order so it appears at the beginning of the child sublist when form layout follows record field order. |
| PO | `custrecord_lcmitems_po` | Select, Purchase Order (`-30`) | Read-only reference to the PO that produced the item line. Script sets this from the PO internal ID; NetSuite displays the PO number (`tranid`). |
| Vendor Name | `custrecord_lcmitems_vendor` | Hidden select, Vendor (`-3`) | Hidden compatibility/reference value sourced from the source PO header. Users do not edit this on item rows. |
| Item | `custrecord_lcmitems_item` | Select, Item (`-10`) | Item from the PO item line. |
| Description | `custrecord_lcmitems_description` | Text Area | Item/line description from the PO line; falls back to item text if memo is empty. |
| Unit Type | `custrecord_lcmitems_unit_type` | Text | Unit text from the PO line. |
| Receiving Location | `custrecord_lcmitems_receiving_location` | Select, Location (`-103`) | Read-only receiving location copied from the source PO line, with the PO header location as fallback. The selector writes its ID and display text before the LCM is saved; missing values on existing LCM Items are backfilled when the LCM form loads. |
| Expected Quantity Receipt | `custrecord_lcmitem_ex_receipt` | Text | PO line quantity still open for receipt: remaining quantity when partially received, otherwise PO quantity. |
| Quantity Receipt | `custrecord_lcmitems_receipt` | Text | Editable quantity that this LCM record is going to receive and bill. Defaults to Expected Quantity Receipt. |
| Quantity Remaining | `custrecord_lcmitems_quantity_remaining` | Text | Computed as Expected Quantity Receipt minus Quantity Receipt. |
| Receive Status | `custrecord_lcmitems_bill_status` | Text | `full` when Expected Quantity Receipt equals Quantity Receipt; otherwise `partial`. Existing field ID is retained for compatibility. |
| PO Currency | `custrecord_lcmitems_po_currency_text` | Text | PO transaction currency text. |
| Exchange Rate | `custrecord_lcmitems_exchange_rate` | Text | Exchange rate from the PO line/header search result. |
| PO Rate | `custrecord_lcmitems_po_rate` | Currency | PO line rate. |
| PO Value | `custrecord_lcmitems_po_value` | Currency | PO Rate multiplied by PO Exchange Rate and editable Quantity Receipt. Stored in base currency for allocation comparison. |
| Unit Landed Cost | `custrecord_lcmitems_unit_landed_cost` | Currency | Result field for Bill landed-cost allocation per unit. Journal Entry amounts are not included in this calculation. |
| Total Unit Cost | `custrecord_lcmitems_total_unit_cost` | Currency | Result field for converted PO rate plus Bill allocated landed cost per unit. Journal Entry amounts are not included in this calculation. |
| Total Value | `custrecord_lcmitems_total_value` | Currency | Total Unit Cost multiplied by editable Quantity Receipt. Stored in base currency. |
| Item Receipt | `custrecord_lcmitems_item_receipt` | Select, Transaction (`-30`) | Script-managed reference to the Item Receipt/GRN transformed from this row's Purchase Order. It prevents duplicate receiving and is locked after creation. |
| Hidden LCM Item | `custrecord_lcm_lcm_hidden_lcm_item` | Parent select to `customrecord_landed_cost_management` | Parent-child link back to the root Landed Cost Management record. This creates the `Items` child sublist. |
| PO Line Key | `custrecord_lcmitems_source_line_key` | Hidden text | Internal generated key from PO ID and PO line unique key. It reconciles persisted LCM item rows and precisely matches the source PO line when its Item Receipt is transformed. |

## 3. Child Custom Record: Landed Cost

| Property | Value |
| --- | --- |
| Record name | Landed Cost |
| Script ID | `customrecord_lcm_landed_cost` |
| Internal type ID | `2519` |
| SDF object | `src/Objects/customrecord_lcm_landed_cost.xml` |
| Parent link | `custrecord_lcm_lcm_hidden_landed_cost` |
| Parent subtab | `Landed Cost` tab on Landed Cost Management |
| Purpose | Stores landed-cost charge rows, accounting target details, allocation settings, amount, currency, and created Bill/Journal references against the root Landed Cost Management record. |

### Landed Cost Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Document Type | `custrecord_lcm_lcm_target_type` | Select, `customlist_lcm_acct_target_type` | Chooses whether this cost row is processed by `Create Bill` or `Create Journal`. Mandatory; defaults to `Bill`. Existing field ID is retained for compatibility. |
| Vendor Name | `custrecord_lcm_lcm_vendor` | Select, Vendor (`-3`) | Required line-level landed-cost vendor. `Create Bill` groups rows by vendor, subsidiary, and currency so one LCM record can create multiple Vendor Bills. Compatible rows inside a Bill group are merged into one Vendor Bill item line when category, cost item, and allocation method also match; effective date and classifications are inherited from the first source row if they differ. The merge identity is built from internal IDs, with the LC Cost Category mapping record rehydrating the hidden derived values first, so display-text differences cannot split a line. |
| LC Cost Category | `custrecord_lcm_lcm_cost_item_map` | Select, `customrecord_lcm_cost_item_map` | User-facing selector. Only active mapping records appear as options, so users can pick only configured LC Cost Category and LC Cost Item combinations. |
| Bill Line Type | `custrecord_lcm_lcm_bill_line_type` | Hidden select, `customlist_lcm_bill_line_type` | Fixed hidden value. Landed-cost bills always create Vendor Bill item lines. |
| Bill Type | `custrecord_lcm_lcm_cost_bill_type` | Hidden select, `customlist_bill_type` | Fixed hidden Vendor Bill body Bill Type source. Generated Vendor Bills use `LC Bill` through `custbody12`. |
| Subsidiary | `custrecord_lcm_lcm_subsidiary` | Hidden select, Subsidiary (`-117`) | Reference field sourced from the Landed Cost row Vendor Name, with parent subsidiary as fallback. |
| Cost Category | `custrecord_lcm_lcm_cost_category` | Hidden select/list | Hidden native Cost Category derived from the selected mapping record. NetSuite metadata identifies the target as internal record/list `-155`; generated Vendor Bills use this to tag item lines. |
| Amount | `custrecord_lcm_lcm_amout` | Currency | Landed-cost amount. Existing field ID spelling is `amout`. |
| Currency | `custrecord_lcm_lcm_currency` | Select/List | Editable currency context for the landed-cost amount and generated transaction. Defaults from the line Vendor Name when possible. |
| Exchange Rate | `custrecord_lcm_lcm_exchange_rate` | Currency/number | Editable exchange rate for landed-cost allocation/base amount calculations. Defaults from the line Vendor Name and refreshes when Currency changes. |
| Effective Date | `custrecord_lcm_lcm_effective_date` | Date | Mandatory effective date for landed-cost allocation/accounting. Defaults to today's date. |
| Allocation Method | `custrecord_lcm_lcm_allo_method` | Select, `customlist_lcm_allocation_method` | Allocation method for distributing landed cost to checked item rows. Defaults to `Value`; generated Vendor Bills copy it to `Landed Cost > Cost Allocation Method`. |
| LC Cost Item | `custrecord_lcm_lcm_cost_item` | Hidden select, Item (`-10`) | Hidden item used when creating Vendor Bill item lines; sourced from the selected `LCM Cost Category Item Map` row. |
| Department | `custrecord_lcm_lcm_department` | Hidden select, Department (`-102`) | Deprecated hidden classification. Removed from the user-facing Landed Cost sublist. |
| Class | `custrecord_lcm_lcm_class` | Hidden select, Class (`-101`) | Deprecated hidden classification. Removed from the user-facing Landed Cost sublist. |
| Memo | `custrecord_lcm_lcm_memo` | Text Area | Memo copied to generated transaction lines. |
| Processing Status | `custrecord_lcm_lcm_status` | Text | Script-managed status. `Created` blocks duplicate accounting creation. |
| Created Transaction ID | `custrecord_lcm_lcm_created_tran_id` | Hidden text | Internal ID of the generated Vendor Bill or Journal Entry. |
| Created Transaction | `custrecord_lcm_lcm_created_tran_ref` | Select, Transaction (`-30`) | Visible transaction reference to the generated Vendor Bill or Journal Entry. |
| Created Transaction Type | `custrecord_lcm_lcm_created_tran_type` | Text | Generated transaction type label, such as Vendor Bill or Journal Entry. |
| Cost Allocated In GRN | `custrecord_lcm_lcm_cost_allocation_grn` | Checkbox | Indicates whether the created Bill cost has been allocated to the generated GRN(s). It is checked only after every positive-quantity LCM Item is linked to an Item Receipt and the item-level allocation succeeds. `Recalculate Landed Cost` refreshes the item values but does not mark a cost allocated before a GRN exists. |
| GRN Number | `custrecord_lcm_lcm_grn_number` | Text | Script-managed comma-separated Item Receipt number(s) created for the LCM record. |

Field lifecycle: `Vendor Name` (`custrecord_lcm_lcm_vendor`), `Bill Type` (`custrecord_lcm_lcm_cost_bill_type`), `LC Cost Item` (`custrecord_lcm_lcm_cost_item`), and `Created Transaction` (`custrecord_lcm_lcm_created_tran_ref`) are the canonical fields used by the current workflow. The duplicate legacy Vendor Name, Deprecated Bill Type, Expense Account, Bill Item, Debit Account, Credit Account, Transaction Number, and Created Date fields are retired and must not be reintroduced. Hidden native `Cost Category` (`custrecord_lcm_lcm_cost_category`) remains for Vendor Bill tagging and GRN allocation; `Legacy LC Cost Category` (`custrecord_lcm_lcm_cost_profile`) is retired. Landed Cost Location is retired: it is represented instead by the read-only PO-sourced `Receiving Location` on LCM Items. Journal accounts are script-configured rather than stored on each Landed Cost row.
| Hidden Landed Cost | `custrecord_lcm_lcm_hidden_landed_cost` | Parent select to `customrecord_landed_cost_management` | Parent-child link back to the root Landed Cost Management record. This creates the `Landed Cost` child sublist. |

## 4. Item Receipt (GRN) Creation

`Create Item Receipt` is available from a saved Landed Cost Management record in View mode. It opens the existing LCM accounting Suitelet with a preview before any transaction is saved.

1. All Bill-type Landed Cost rows must already be `Created`. New landed-cost Bills are intentionally blocked once an Item Receipt exists on the LCM record; use a new LCM record for later charges.
2. The Suitelet groups positive `Quantity Receipt` LCM Items by Purchase Order and transforms one NetSuite `Item Receipt` from each PO. Only the exact source PO lines represented by LCM Items are received, with their configured quantities.
3. The transformed Item Receipt is stamped with `custbody_lcm_ir_source_key` (`LCM<root id>::PO<PO id>`). If the transaction is saved but the LCM Item reference write fails, the next run finds this marker and relinks the rows instead of receiving inventory twice.
4. Generated landed-cost Bills can be selected as an `Other Transaction` source on only one Item Receipt in NetSuite. Because one LCM can span multiple POs, this flow calculates each receipt's share in base currency using the existing tracked-item allocation, converts it into that PO's receipt currency, and writes the category values as `Manual` landed cost on the Item Receipt.
5. All created Bill rows must have one effective allocation method (`Value`, `Quantity`, or `Weight`) for a native Item Receipt posting. The preview rejects mixed methods instead of posting a different native allocation from the LCM item calculation.
6. The preview inspects the transformed Item Receipt and lists every line where NetSuite requires `Inventory Detail`, but no additional receiver form is shown. For a nonserialized lot item, the Item Receipt creates one assignment for the LCM Item receipt quantity and uses `Shipment Number + Item` as the deterministic Receipt Inventory Number. A required Bin preserves the location default that NetSuite sources on the transformed receipt, with `DEFAULTS.itemReceipt` as an optional location fallback. A required Inventory Status uses the active standard NetSuite default status when the transformed receipt does not expose one, then uses the optional `DEFAULTS.itemReceipt` fallback only if that account lookup is unavailable. Serialized items and items that require an Expiration Date are blocked before confirmation because physical serials and supplier expiry data must not be invented.
7. After every positive-quantity LCM Item is linked to an Item Receipt, the flow refreshes `Unit Landed Cost`, `Total Unit Cost`, and `Total Value`, marks Bill rows `Cost Allocated In GRN`, writes the GRN number(s), and recalculates Shipment Status. Receipt-defining LCM Item fields (PO, item, PO Line Key, Quantity Receipt, Track Item, and Item Receipt reference) are then locked in both the parent form and direct child-record saves.

The Item Receipt marker is a hidden transaction body field deployed by `src/Objects/custbody_lcm_ir_source_key.xml`; it applies to Item Receipts only and must remain deployed for rerun safety.

## 5. Mapping Custom Record: LCM Cost Category Item Map

| Property | Value |
| --- | --- |
| Record name | LCM Cost Category Item Map |
| Script ID | `customrecord_lcm_cost_item_map` |
| SDF object | `src/Objects/customrecord_lcm_cost_item_map.xml` |
| Purpose | Admin-maintained mapping from native NetSuite landed cost categories to the item used on generated Vendor Bill item lines. Active rows become the user-facing `LC Cost Category` options on Landed Cost rows. |

### Mapping Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| LC Cost Category | `custrecord_lcm_ccim_category` | Select, native Cost Category (`-155`) | Category selected on the Landed Cost row. |
| LC Cost Item | `custrecord_lcm_ccim_item` | Select, Item (`-10`) | Active item to use on the generated Vendor Bill item line for that category. |
| Memo | `custrecord_lcm_ccim_memo` | Text Area | Optional implementation note for admins. |

Mapping behavior:

- Each active LC Cost Category should have exactly one active mapping row.
- `customscript_lcm_cost_item_map_ue` blocks duplicate active mappings for the same category.
- The mapping User Event also names each mapping record from the selected LC Cost Category so the Landed Cost dropdown displays the category text.
- Inactivating a mapping row removes it from the user-facing Landed Cost options.

## 6. Related Documents

- [Implemented requirements](./lcm_implemented_requirements.md)
- [PO selection deployment notes](./lcm_po_selection_deployment.md)
