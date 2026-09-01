# Landed Cost Management - Record Reference

Last updated: 2026-08-24

This document is the working record and field reference for the Landed Cost Management customization. It captures the current NetSuite custom records, field usage, and parent-child relationships. For implemented behavior and requirement chunks, see [lcm_implemented_requirements.md](./lcm_implemented_requirements.md).

## 1. Root Custom Record

| Property | Value |
| --- | --- |
| Record name | Landed Cost Management |
| Script ID | `customrecord_landed_cost_management` |
| Internal type ID | `2517` |
| SDF object | `src/Objects/customrecord_landed_cost_management.xml` |
| Purpose | Header/root record for landed cost processing. It stores shipment, LC, port, incoterm, and selected PO context, and owns child item and landed-cost rows. |
| UI tabs | `Items`, `Landed Cost`, plus standard notes/files tabs |
| Main customization added | Header-level `Selected Purchase Orders` multi-select supports the generated `LCM Items` child sublist. |

### Root Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Shipment Number | `custrecord_lcm_shipment_number` | Text | LCM/shipment reference number. |
| Shipment Date | `custrecord_lcm_shipment_date` | Date | Shipment date for the landed cost record. |
| Subsidiary | `custrecord_lcm_subsidiary` | Select, `-117` | Subsidiary context sourced from Vendor and disabled on the form. |
| Vendor | `custrecord_lcm_vendor` | Select, Vendor (`-3`) | Header vendor for selected PO filtering and generated landed-cost accounting. |
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
| Purpose | Generated item-level rows from selected Purchase Order item lines. These rows provide the item, PO, quantity, rate, and tracking context for later landed-cost work. |

### LCM Items Field Reference

| Name | Field ID | Type | What this is for |
| --- | --- | --- | --- |
| Track Item | `custrecord_lcmitems_track_item` | Checkbox | Line-level marker for future processing. Placed first in the field order so it appears at the beginning of the child sublist when form layout follows record field order. |
| PO | `custrecord_lcmitems_po` | Select, Purchase Order (`-30`) | Read-only reference to the PO that produced the item line. Script sets this from the PO internal ID; NetSuite displays the PO number (`tranid`). |
| Vendor Name | `custrecord_lcmitems_vendor` | Hidden select, Vendor (`-3`) | Hidden compatibility/reference value sourced from the parent Vendor/PO header. Users select Vendor on the parent record. |
| Item | `custrecord_lcmitems_item` | Select, Item (`-10`) | Item from the PO item line. |
| Description | `custrecord_lcmitems_description` | Text Area | Item/line description from the PO line; falls back to item text if memo is empty. |
| Unit Type | `custrecord_lcmitems_unit_type` | Text | Unit text from the PO line. |
| Expected Quantity Receipt | `custrecord_lcmitem_ex_receipt` | Text | PO line quantity expected to be received. |
| Quantity Receipt | `custrecord_lcmitems_receipt` | Text | Quantity already received from the PO line (`quantityshiprecv`). |
| Quantity Remaining | `custrecord_lcmitems_quantity_remaining` | Text | Computed as PO quantity minus received quantity. |
| Quantity Bill | `custrecord_lcmitems_quantity_bill` | Currency | Quantity billed from the PO line (`quantitybilled`). Existing field type is Currency even though the value is quantity-like. |
| PO Currency | `custrecord_lcmitems_po_currency` | Currency | Existing field labelled PO Currency. Current scripts do not populate this with a currency record because the field type is Currency amount, not List/Record Currency. |
| Exchange Rate | `custrecord_lcmitems_exchange_rate` | Text | Exchange rate from the PO line/header search result. |
| PO Rate | `custrecord_lcmitems_po_rate` | Currency | PO line rate. |
| Unit Landed Cost | `custrecord_lcmitems_unit_landed_cost` | Currency | Placeholder/result field for future landed cost per unit. Current PO-population scripts do not calculate this. |
| Total Unit Cost | `custrecord_lcmitems_total_unit_cost` | Currency | Placeholder/result field for future total unit cost. Current PO-population scripts do not calculate this. |
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
| Bill Line Type | `custrecord_lcm_lcm_bill_line_type` | Select, `customlist_lcm_bill_line_type` | Chooses whether a Bill row creates an Expense line or Item line. |
| Bill Type | `custrecord_lcm_lcm_cost_bill_type` | Select, `customlist_bill_type` | Existing Vendor Bill body Bill Type source. Set on generated Vendor Bills as `custbody12`. Values include Regular Bill and LC Bill. |
| Vendor | `custrecord_lcm_lcm_vendor` | Hidden select, Vendor (`-3`) | Compatibility/reference field sourced from parent Vendor. Users do not edit Vendor per Landed Cost row. |
| Subsidiary | `custrecord_lcm_lcm_subsidiary` | Select, Subsidiary (`-117`) | Read-only form field sourced from parent Vendor/parent Subsidiary for generated Vendor Bills and Journal Entries. |
| LC Cost Profile | `custrecord_lcm_lcm_cost_profile` | Select, `customlist_lcm_cost_profile` | Visible LC-specific selector. Scripts map each value to hidden native Cost Category and Bill Item references. |
| Cost Category | `custrecord_lcm_lcm_cost_category` | Hidden select/list | Hidden native Cost Category for the landed-cost charge. NetSuite metadata identifies the target as internal record/list `-155`. |
| Amount | `custrecord_lcm_lcm_amout` | Currency | Landed-cost amount. Existing field ID spelling is `amout`. |
| Currency | `custrecord_lcm_lcm_currency` | Select/List | Currency context for the landed-cost amount. Sourced from selected vendor through a dynamic Vendor Bill draft when possible. Generated Vendor Bills/Journals let NetSuite source valid transaction currency from vendor/subsidiary. |
| Exchange Rate | `custrecord_lcm_lcm_exchange_rate` | Currency/number | Exchange rate for the landed-cost charge. Sourced from selected vendor through a dynamic Vendor Bill draft when possible. |
| Effective Date | `custrecord_lcm_lcm_effective_date` | Date | Effective date for landed-cost allocation/accounting. |
| Allocation Method | `custrecord_lcm_lcm_allo_method` | Select, `customlist_lcm_allocation_method` | Allocation method for distributing landed cost to checked item rows. Defaults to `Value`; generated Vendor Bills copy it to `Landed Cost > Cost Allocation Method`. |
| Expense Account | `custrecord_lcm_lcm_expense_account` | Select, Account (`-112`) | Account used when a Bill row creates an Expense line. Sourced from selected vendor when possible. |
| LC Cost Item | `custrecord_lcm_lcm_cost_item` | Select, Item (`-10`) | Item used when a Bill row creates an Item line; sourced from LC Cost Profile. |
| Debit Account | `custrecord_lcm_lcm_debit_account` | Hidden select, Account (`-112`) | Deprecated fallback for legacy Journal rows. New Journal rows use fixed script constants. |
| Credit Account | `custrecord_lcm_lcm_credit_account` | Hidden select, Account (`-112`) | Deprecated fallback for legacy Journal rows. New Journal rows use fixed script constants. |
| Department | `custrecord_lcm_lcm_department` | Select, Department (`-102`) | Optional accounting classification copied to generated transaction lines. |
| Class | `custrecord_lcm_lcm_class` | Select, Class (`-101`) | Optional accounting classification copied to generated transaction lines. |
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

## 4. Related Documents

- [Implemented requirements](./lcm_implemented_requirements.md)
- [PO selection deployment notes](./lcm_po_selection_deployment.md)
