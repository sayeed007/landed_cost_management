# Landed Cost Management - Record Reference

Last updated: 2026-09-10

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
| Main customization added | Header-level `Selected Purchase Orders` multi-select supports the generated `LCM Items` child sublist. |

### Root Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Shipment Number | `custrecord_lcm_shipment_number` | Text | Legacy hidden shipment number text field. Shipment numbering now uses the custom record auto-number/name with `SHIP-` prefix and 5 minimum digits. |
| Shipment Date | `custrecord_lcm_shipment_date` | Date | Shipment date for the landed cost record. |
| Subsidiary | `custrecord_lcm_subsidiary` | Select, `-117` | Subsidiary context sourced from Vendor and disabled on the form. |
| Purchase Order Vendor | `custrecord_lcm_vendor` | Select, Vendor (`-3`) | Header vendor used only for selected PO filtering and validation. Landed Cost row `Vendor Name` drives generated Vendor Bills. |
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
| Selected Purchase Orders | `custrecord_lcm_selected_pos` | Multi-select, Purchase Order (`-30`) | Header-level PO selector filtered/validated by Vendor. Changing this field regenerates the `LCM Items` child sublist from selected PO item lines. |
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
| Purpose | Generated item-level rows from selected receivable Purchase Order item lines that still have quantity open to receive. These rows provide the item, PO, editable receipt quantity, rate, values, and tracking context for later landed-cost work. |

### LCM Items Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Track Item | `custrecord_lcmitems_track_item` | Checkbox | Line-level marker for future processing. Placed first in the field order so it appears at the beginning of the child sublist when form layout follows record field order. |
| PO | `custrecord_lcmitems_po` | Select, Purchase Order (`-30`) | Read-only reference to the PO that produced the item line. Script sets this from the PO internal ID; NetSuite displays the PO number (`tranid`). |
| Vendor Name | `custrecord_lcmitems_vendor` | Hidden select, Vendor (`-3`) | Hidden compatibility/reference value sourced from the source PO header. Users do not edit this on item rows. |
| Item | `custrecord_lcmitems_item` | Select, Item (`-10`) | Item from the PO item line. |
| Description | `custrecord_lcmitems_description` | Text Area | Item/line description from the PO line; falls back to item text if memo is empty. |
| Unit Type | `custrecord_lcmitems_unit_type` | Text | Unit text from the PO line. |
| Expected Quantity Receipt | `custrecord_lcmitem_ex_receipt` | Text | PO line quantity still open for receipt: remaining quantity when partially received, otherwise PO quantity. |
| Quantity Receipt | `custrecord_lcmitems_receipt` | Text | Editable quantity that this LCM record is going to receive and bill. Defaults to Expected Quantity Receipt. |
| Quantity Remaining | `custrecord_lcmitems_quantity_remaining` | Text | Computed as Expected Quantity Receipt minus Quantity Receipt. |
| Quantity Bill | `custrecord_lcmitems_quantity_bill` | Currency | Deprecated hidden field. Removed from the user-facing Items sublist. |
| Bill Status | `custrecord_lcmitems_bill_status` | Text | `full` when Expected Quantity Receipt equals Quantity Receipt; otherwise `partial`. |
| PO Currency | `custrecord_lcmitems_po_currency` | Currency | Existing field labelled PO Currency. Current scripts do not populate this with a currency record because the field type is Currency amount, not List/Record Currency. |
| Exchange Rate | `custrecord_lcmitems_exchange_rate` | Text | Exchange rate from the PO line/header search result. |
| PO Rate | `custrecord_lcmitems_po_rate` | Currency | PO line rate. |
| PO Value | `custrecord_lcmitems_po_value` | Currency | PO Rate multiplied by editable Quantity Receipt. |
| Unit Landed Cost | `custrecord_lcmitems_unit_landed_cost` | Currency | Result field for Bill landed-cost allocation per unit. Journal Entry amounts are not included in this calculation. |
| Total Unit Cost | `custrecord_lcmitems_total_unit_cost` | Currency | Result field for PO rate plus Bill allocated landed cost per unit. Journal Entry amounts are not included in this calculation. |
| Total Value | `custrecord_lcmitems_total_value` | Currency | Total Unit Cost multiplied by editable Quantity Receipt. |
| Hidden LCM Item | `custrecord_lcm_lcm_hidden_lcm_item` | Parent select to `customrecord_landed_cost_management` | Parent-child link back to the root Landed Cost Management record. This creates the `Items` child sublist. |
| PO Line Key | `custrecord_lcmitems_source_line_key` | Hidden text | Internal generated key from PO ID and PO line unique key. Used as a persisted trace/debug key. Current UI refresh clears and rebuilds lines, so it is not used as the primary duplicate prevention mechanism. |

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
| Target Type | `custrecord_lcm_lcm_target_type` | Select, `customlist_lcm_acct_target_type` | Chooses whether this cost row is processed by `Create Bill` or `Create Journal`. |
| Vendor Name | `custrecord_lcm_lcm_vendor` | Select, Vendor (`-3`) | Required line-level landed-cost vendor. `Create Bill` groups rows by this vendor so one LCM record can create multiple Vendor Bills. |
| LC Cost Category | `custrecord_lcm_lcm_cost_item_map` | Select, `customrecord_lcm_cost_item_map` | User-facing selector. Only active mapping records appear as options, so users can pick only configured LC Cost Category and LC Cost Item combinations. |
| Bill Line Type | `custrecord_lcm_lcm_bill_line_type` | Hidden select, `customlist_lcm_bill_line_type` | Fixed hidden value. Landed-cost bills always create Vendor Bill item lines. |
| Bill Type | `custrecord_lcm_lcm_cost_bill_type` | Hidden select, `customlist_bill_type` | Fixed hidden Vendor Bill body Bill Type source. Generated Vendor Bills use `LC Bill` through `custbody12`. |
| Subsidiary | `custrecord_lcm_lcm_subsidiary` | Hidden select, Subsidiary (`-117`) | Reference field sourced from the Landed Cost row Vendor Name, with parent subsidiary as fallback. |
| Legacy LC Cost Category | `custrecord_lcm_lcm_cost_profile` | Hidden select, native Cost Category (`-155`) | Deprecated user-facing selector retained for old rows/data compatibility only. New rows use `custrecord_lcm_lcm_cost_item_map`. |
| Cost Category | `custrecord_lcm_lcm_cost_category` | Hidden select/list | Hidden native Cost Category derived from the selected mapping record. NetSuite metadata identifies the target as internal record/list `-155`; generated Vendor Bills use this to tag item lines. |
| Amount | `custrecord_lcm_lcm_amout` | Currency | Landed-cost amount. Existing field ID spelling is `amout`. |
| Currency | `custrecord_lcm_lcm_currency` | Select/List | Editable currency context for the landed-cost amount and generated transaction. Defaults from the line Vendor Name when possible. |
| Exchange Rate | `custrecord_lcm_lcm_exchange_rate` | Currency/number | Editable exchange rate for landed-cost allocation/base amount calculations. Defaults from the line Vendor Name when possible. |
| Effective Date | `custrecord_lcm_lcm_effective_date` | Date | Effective date for landed-cost allocation/accounting. |
| Allocation Method | `custrecord_lcm_lcm_allo_method` | Select, `customlist_lcm_allocation_method` | Allocation method for distributing landed cost to checked item rows. Defaults to `Value`; generated Vendor Bills copy it to `Landed Cost > Cost Allocation Method`. |
| Expense Account | `custrecord_lcm_lcm_expense_account` | Hidden select, Account (`-112`) | Account used when a Bill row creates an Expense line. Sourced from selected vendor when possible. |
| LC Cost Item | `custrecord_lcm_lcm_cost_item` | Hidden select, Item (`-10`) | Hidden item used when creating Vendor Bill item lines; sourced from the selected `LCM Cost Category Item Map` row. |
| Debit Account | `custrecord_lcm_lcm_debit_account` | Hidden select, Account (`-112`) | Deprecated fallback for legacy Journal rows. New Journal rows try fixed script constant `journalDebitAccount`, then active account candidates. |
| Credit Account | `custrecord_lcm_lcm_credit_account` | Hidden select, Account (`-112`) | Deprecated fallback for legacy Journal rows. New Journal rows try fixed script constant `journalCreditAccount`, then active account candidates. |
| Department | `custrecord_lcm_lcm_department` | Hidden select, Department (`-102`) | Deprecated hidden classification. Removed from the user-facing Landed Cost sublist. |
| Class | `custrecord_lcm_lcm_class` | Hidden select, Class (`-101`) | Deprecated hidden classification. Removed from the user-facing Landed Cost sublist. |
| Location | `custrecord_lcm_lcm_location` | Select, Location (`-103`) | Optional accounting classification copied to generated transaction lines. |
| Memo | `custrecord_lcm_lcm_memo` | Text Area | Memo copied to generated transaction lines. |
| Transaction Number | `custrecord_lcm_lcm_transaction_number` | Text | Created transaction number/reference. |
| Processing Status | `custrecord_lcm_lcm_status` | Text | Script-managed status. `Created` blocks duplicate accounting creation. |
| Created Transaction ID | `custrecord_lcm_lcm_created_tran_id` | Hidden text | Internal ID of the generated Vendor Bill or Journal Entry. |
| Created Transaction | `custrecord_lcm_lcm_created_tran_ref` | Select, Transaction (`-30`) | Visible transaction reference to the generated Vendor Bill or Journal Entry. |
| Created Transaction Type | `custrecord_lcm_lcm_created_tran_type` | Text | Generated transaction type label, such as Vendor Bill or Journal Entry. |
| Created Date | `custrecord_lcm_lcm_created_date` | Date | Defaults to today when the Landed Cost row is saved; updated when accounting transaction is created. |
| Cost Allocated In GRN | `custrecord_lcm_lcm_cost_allocation_grn` | Checkbox | Indicates whether the created cost has been allocated to tracked item rows. |
| GRN Number | `custrecord_lcm_lcm_grn_number` | Text | GRN reference number. |
| Hidden Landed Cost | `custrecord_lcm_lcm_hidden_landed_cost` | Parent select to `customrecord_landed_cost_management` | Parent-child link back to the root Landed Cost Management record. This creates the `Landed Cost` child sublist. |

## 4. Mapping Custom Record: LCM Cost Category Item Map

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

## 5. Related Documents

- [Implemented requirements](./lcm_implemented_requirements.md)
- [PO selection deployment notes](./lcm_po_selection_deployment.md)
