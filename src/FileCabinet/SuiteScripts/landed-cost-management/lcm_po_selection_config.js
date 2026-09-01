/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([], () => {
  const RECORDS = {
    landedCostManagement: 'customrecord_landed_cost_management',
    lcmItems: 'customrecord_lcmitems',
    lcmLandedCosts: 'customrecord_lcm_landed_cost',
  };

  const FIELDS = {
    landedCostManagement: {
      vendor: 'custrecord_lcm_vendor',
      subsidiary: 'custrecord_lcm_subsidiary',
      selectedPurchaseOrders: 'custrecord_lcm_selected_pos',
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
      quantityBill: 'custrecord_lcmitems_quantity_bill',
      unitType: 'custrecord_lcmitems_unit_type',
      poRate: 'custrecord_lcmitems_po_rate',
      unitLandedCost: 'custrecord_lcmitems_unit_landed_cost',
      totalUnitCost: 'custrecord_lcmitems_total_unit_cost',
      exchangeRate: 'custrecord_lcmitems_exchange_rate',
      trackItem: 'custrecord_lcmitems_track_item',

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
      costProfile: 'custrecord_lcm_lcm_cost_profile',
      costCategory: 'custrecord_lcm_lcm_cost_category',
      amount: 'custrecord_lcm_lcm_amout',
      currency: 'custrecord_lcm_lcm_currency',
      exchangeRate: 'custrecord_lcm_lcm_exchange_rate',
      effectiveDate: 'custrecord_lcm_lcm_effective_date',
      allocationMethod: 'custrecord_lcm_lcm_allo_method',
      expenseAccount: 'custrecord_lcm_lcm_expense_account',
      billItem: 'custrecord_lcm_lcm_cost_item',
      debitAccount: 'custrecord_lcm_lcm_debit_account',
      creditAccount: 'custrecord_lcm_lcm_credit_account',
      department: 'custrecord_lcm_lcm_department',
      class: 'custrecord_lcm_lcm_class',
      location: 'custrecord_lcm_lcm_location',
      memo: 'custrecord_lcm_lcm_memo',
      transactionNumber: 'custrecord_lcm_lcm_transaction_number',
      processingStatus: 'custrecord_lcm_lcm_status',
      createdTransactionId: 'custrecord_lcm_lcm_created_tran_id',
      createdTransactionRef: 'custrecord_lcm_lcm_created_tran_ref',
      createdTransactionType: 'custrecord_lcm_lcm_created_tran_type',
      createdDate: 'custrecord_lcm_lcm_created_date',
      costAllocatedInGrn: 'custrecord_lcm_lcm_cost_allocation_grn',
      grnNumber: 'custrecord_lcm_lcm_grn_number',
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
    accountingSuitelet: {
      scriptId: 'customscript_lcm_accounting_sl',
      deploymentId: 'customdeploy_lcm_accounting_sl',
    },
  };

  // Diagnostics for the LC Cost Profile -> LC Cost Item sourcing. Turn these off once the
  // field ids are confirmed against the live form; they are verbose by design.
  const DEBUG = {
    // Server side: logs every custrecord field on the rendered Landed Cost form with its id and
    // label, so the real field id behind a label can be read off the execution log.
    logFormFields: true,
    // Client side: announces that the client script loaded, and alerts when sourcing cannot run.
    announceClientLoad: true,
    // Temporary browser alerts for tracing which field id NetSuite sends on fieldChanged.
    traceClientEvents: true,
    // Temporary visible marker proving the Landed Cost row User Event ran beforeLoad.
    showServerBanner: true,
  };

  const TRANSACTION_FIELDS = {
    vendorBill: {
      billType: 'custbody12',
      landedCostMethod: 'landedcostmethod',
    },
  };

  const ACCOUNT_CONSTANTS = {
    // Configure these account-specific internal IDs before relying on new Journal rows.
    journalDebitAccount: '',
    journalCreditAccount: '',
  };

  return { RECORDS, FIELDS, SUBLISTS, SCRIPTS, TRANSACTION_FIELDS, ACCOUNT_CONSTANTS, DEBUG };
});
