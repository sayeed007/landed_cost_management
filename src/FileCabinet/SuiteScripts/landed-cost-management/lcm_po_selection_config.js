/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  const RECORDS = {
    landedCostManagement: 'customrecord_landed_cost_management',
    lcmItems: 'customrecord_lcmitems',
    lcmLandedCosts: 'customrecord_lcm_landed_cost',
    lcmCostItemMap: 'customrecord_lcm_cost_item_map',
  };

  const FIELDS = {
    landedCostManagement: {
      vendor: 'custrecord_lcm_vendor',
      subsidiary: 'custrecord_lcm_subsidiary',
      selectedPurchaseOrders: 'custrecord_lcm_selected_pos',
      shipmentStatus: 'custrecord_lcm_shipment_status',
      shipmentNumber: 'custrecord_lcm_shipment_number',
    },
    lcmItems: {
      parent: 'custrecord_lcm_lcm_hidden_lcm_item',
      purchaseOrder: 'custrecord_lcmitems_po',
      item: 'custrecord_lcmitems_item',
      description: 'custrecord_lcmitems_description',
      vendor: 'custrecord_lcmitems_vendor',
      quantityReceipt: 'custrecord_lcmitems_receipt',
      expectedQuantityReceipt: 'custrecord_lcmitem_ex_receipt',
      quantityRemaining: 'custrecord_lcmitems_quantity_remaining',
      billStatus: 'custrecord_lcmitems_bill_status',
      unitType: 'custrecord_lcmitems_unit_type',
      receivingLocation: 'custrecord_lcmitems_receiving_location',
      poCurrencyText: 'custrecord_lcmitems_po_currency_text',
      poRate: 'custrecord_lcmitems_po_rate',
      poValue: 'custrecord_lcmitems_po_value',
      unitLandedCost: 'custrecord_lcmitems_unit_landed_cost',
      totalUnitCost: 'custrecord_lcmitems_total_unit_cost',
      totalValue: 'custrecord_lcmitems_total_value',
      exchangeRate: 'custrecord_lcmitems_exchange_rate',
      trackItem: 'custrecord_lcmitems_track_item',
      itemReceipt: 'custrecord_lcmitems_item_receipt',

      // Create this hidden text field on LCM Items.
      poLineKey: 'custrecord_lcmitems_source_line_key',
    },
    lcmLandedCosts: {
      parent: 'custrecord_lcm_lcm_hidden_landed_cost',
      targetType: 'custrecord_lcm_lcm_target_type',
      billLineType: 'custrecord_lcm_lcm_bill_line_type',
      billType: 'custrecord_lcm_lcm_cost_bill_type',
      vendor: 'custrecord_lcm_lcm_vendor',
      subsidiary: 'custrecord_lcm_lcm_subsidiary',
      costItemMap: 'custrecord_lcm_lcm_cost_item_map',
      costCategory: 'custrecord_lcm_lcm_cost_category',
      amount: 'custrecord_lcm_lcm_amout',
      currency: 'custrecord_lcm_lcm_currency',
      exchangeRate: 'custrecord_lcm_lcm_exchange_rate',
      effectiveDate: 'custrecord_lcm_lcm_effective_date',
      allocationMethod: 'custrecord_lcm_lcm_allo_method',
      billItem: 'custrecord_lcm_lcm_cost_item',
      department: 'custrecord_lcm_lcm_department',
      class: 'custrecord_lcm_lcm_class',
      memo: 'custrecord_lcm_lcm_memo',
      appendExistingBill: 'custrecord_lcm_lcm_append_existing_bill',
      targetVendorBill: 'custrecord_lcm_lcm_target_vendor_bill',
      billGroup: 'custrecord_lcm_lcm_bill_group',
      processingStatus: 'custrecord_lcm_lcm_status',
      createdTransactionId: 'custrecord_lcm_lcm_created_tran_id',
      createdTransactionRef: 'custrecord_lcm_lcm_created_tran_ref',
      createdTransactionType: 'custrecord_lcm_lcm_created_tran_type',
      costAllocatedInGrn: 'custrecord_lcm_lcm_cost_allocation_grn',
      grnNumber: 'custrecord_lcm_lcm_grn_number',
    },
    lcmCostItemMap: {
      costCategory: 'custrecord_lcm_ccim_category',
      costItem: 'custrecord_lcm_ccim_item',
      memo: 'custrecord_lcm_ccim_memo',
    },
  };

  const SUBLISTS = {
    lcmItems: `recmach${FIELDS.lcmItems.parent}`,
    lcmLandedCosts: `recmach${FIELDS.lcmLandedCosts.parent}`,
  };

  const SCRIPTS = {
    poLinesSuitelet: {
      scriptId: 'customscript_lcm_po_lines_sl',
      deploymentId: 'customdeploy_lcm_po_lines_sl',
    },
    poSelectorSuitelet: {
      scriptId: 'customscript_lcm_po_selector_sl',
      deploymentId: 'customdeploy_lcm_po_selector_sl',
    },
    accountingSuitelet: {
      scriptId: 'customscript_lcm_accounting_sl',
      deploymentId: 'customdeploy_lcm_accounting_sl',
    },
  };

  const DEBUG = {
    logFormFields: false,
    announceClientLoad: false,
    traceClientEvents: false,
    showServerBanner: false,
  };

  const TRANSACTION_FIELDS = {
    vendorBill: {
      billType: 'custbody12',
      landedCostMethod: 'landedcostmethod',
    },
    vendorBillLine: {
      // Ownership marker stamped on every landed-cost line this tool generates, so a later
      // append can tell its own lines apart from anything else on the Bill.
      // Deployed as src/Objects/custcol_lcm_source_key.xml.
      sourceKey: 'custcol_lcm_source_key',
    },
    itemReceipt: {
      // One deterministic marker per LCM/PO receipt. It allows a rerun to reconnect LCM
      // items to a receipt saved before the child-row link could be persisted.
      sourceKey: 'custbody_lcm_ir_source_key',
      landedCostMethod: 'landedcostmethod',
    },
  };

  const ACCOUNT_CONSTANTS = {
    // Temporary fixed account internal IDs; replace with approved LCM posting accounts.
    journalDebitAccount: '1',
    journalCreditAccount: '2',
  };

  const DEFAULTS = {
    targetTypeText: 'Bill',
    billLineTypeText: 'Item',
    billTypeText: 'LC Bill',
    shipmentStatusText: 'To Be Shipped',
    itemReceipt: {
      // Configure these once with approved NetSuite internal IDs when the account requires
      // bin or inventory-status assignments on a receipt. The key is the PO item-line
      // location ID; `default` is an optional fallback for every receiving location.
      receivingBinByLocation: {},
      receivingInventoryStatusByLocation: {},
    },
  };

  const SHIPMENT_STATUS = {
    toBeShipped: 'To Be Shipped',
    inTransit: 'In Transit',
    partiallyReceived: 'Partially Received',
    received: 'Received',
  };

  return {
    RECORDS,
    FIELDS,
    SUBLISTS,
    SCRIPTS,
    TRANSACTION_FIELDS,
    ACCOUNT_CONSTANTS,
    DEFAULTS,
    SHIPMENT_STATUS,
    DEBUG,
  };
});
