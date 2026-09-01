/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/log', 'N/ui/serverWidget', './lcm_po_selection_config', './lcm_po_selection_lib'], (
  error,
  log,
  serverWidget,
  config,
  lib
) => {
  const { FIELDS, SUBLISTS } = config;

  function beforeLoad(context) {
    if (context.type === context.UserEventType.DELETE) return;

    context.form.clientScriptModulePath = './lcm_po_selection_client.js';

    orderHeaderFields(context.form);
    disableBodyField(context.form, FIELDS.landedCostManagement.subsidiary);
    disableSublistFields(context.form, SUBLISTS.lcmItems, [
      FIELDS.lcmItems.purchaseOrder,
      FIELDS.lcmItems.item,
      FIELDS.lcmItems.description,
      FIELDS.lcmItems.quantityReceipt,
      FIELDS.lcmItems.expectedQuantityReceipt,
      FIELDS.lcmItems.quantityRemaining,
      FIELDS.lcmItems.quantityBill,
      FIELDS.lcmItems.unitType,
      FIELDS.lcmItems.poRate,
      FIELDS.lcmItems.exchangeRate,
      FIELDS.lcmItems.unitLandedCost,
      FIELDS.lcmItems.totalUnitCost,
    ]);
    disableSublistFields(context.form, SUBLISTS.lcmLandedCosts, [
      FIELDS.lcmLandedCosts.billType,
      FIELDS.lcmLandedCosts.subsidiary,
      FIELDS.lcmLandedCosts.costCategory,
      FIELDS.lcmLandedCosts.currency,
      FIELDS.lcmLandedCosts.exchangeRate,
      FIELDS.lcmLandedCosts.allocationMethod,
      FIELDS.lcmLandedCosts.expenseAccount,
      FIELDS.lcmLandedCosts.billItem,
    ]);

    if (
      context.type === context.UserEventType.CREATE ||
      context.type === context.UserEventType.COPY ||
      context.type === context.UserEventType.EDIT
    ) {
      context.form.addButton({
        id: 'custpage_lcm_select_all_track_items',
        label: 'Select All Track Items',
        functionName: 'selectAllLcmTrackItems()',
      });
    }

    if (context.type === context.UserEventType.VIEW && context.newRecord.id) {
      context.form.addButton({
        id: 'custpage_lcm_create_bill',
        label: 'Create Bill',
        functionName: 'openLcmAccountingPreview("bill")',
      });
      context.form.addButton({
        id: 'custpage_lcm_create_journal',
        label: 'Create Journal',
        functionName: 'openLcmAccountingPreview("journal")',
      });
    }
  }

  function beforeSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;
    sourceHeaderVendorDefaults(context.newRecord);
    validateSelectedPurchaseOrders(context.newRecord);
    if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY) return;
    if (!context.oldRecord || !context.newRecord.id) return;
    if (!shouldSyncPoItems(context)) return;
    if (!lib.hasCreatedAccountingRows(context.newRecord.id)) return;

    throw error.create({
      name: 'LCM_PO_CHANGE_BLOCKED',
      message: 'Selected Purchase Orders cannot be changed after any Landed Cost row has created a Bill or Journal Entry.',
      notifyOff: false,
    });
  }

  function afterSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;
    if (!shouldSyncPoItems(context)) return;

    const parentId = context.newRecord.id;
    const selectedPoIds = lib.normalizeIds(
      context.newRecord.getValue({
        fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders,
      })
    );
    const vendorId = context.newRecord.getValue({
      fieldId: FIELDS.landedCostManagement.vendor,
    });

    try {
      const summary = lib.syncPersistedItems(parentId, selectedPoIds, vendorId);
      log.audit({ title: 'LCM PO item sync complete', details: summary });
    } catch (error) {
      log.error({ title: 'LCM PO item sync failed', details: error });
      throw error;
    }
  }

  function shouldSyncPoItems(context) {
    if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY) {
      return true;
    }

    if (!context.oldRecord) return true;

    const oldVendor = normalizeValue(context.oldRecord.getValue({ fieldId: FIELDS.landedCostManagement.vendor }));
    const newVendor = normalizeValue(context.newRecord.getValue({ fieldId: FIELDS.landedCostManagement.vendor }));
    if (oldVendor !== newVendor) return true;

    const oldSelected = normalizeSelection(
      context.oldRecord.getValue({
        fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders,
      })
    );
    const newSelected = normalizeSelection(
      context.newRecord.getValue({
        fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders,
      })
    );

    return oldSelected !== newSelected;
  }

  function sourceHeaderVendorDefaults(rec) {
    const vendorId = rec.getValue({ fieldId: FIELDS.landedCostManagement.vendor });
    if (!vendorId) return;

    const defaults = lib.getVendorDefaults(vendorId);
    if (defaults.subsidiary) {
      rec.setValue({
        fieldId: FIELDS.landedCostManagement.subsidiary,
        value: defaults.subsidiary,
      });
    }
  }

  function validateSelectedPurchaseOrders(rec) {
    const vendorId = rec.getValue({ fieldId: FIELDS.landedCostManagement.vendor });
    const selectedPoIds = lib.normalizeIds(
      rec.getValue({ fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders })
    );
    if (selectedPoIds.length && !vendorId) {
      throw error.create({
        name: 'LCM_VENDOR_REQUIRED_FOR_PO',
        message: 'Select Vendor before selecting Purchase Orders.',
        notifyOff: false,
      });
    }
    lib.validatePurchaseOrderVendor(selectedPoIds, vendorId);
  }

  function normalizeSelection(value) {
    return lib.normalizeIds(value).sort().join(',');
  }

  function normalizeValue(value) {
    if (Array.isArray(value)) return value.map(String).sort().join(',');
    return String(value === null || value === undefined ? '' : value);
  }

  function orderHeaderFields(form) {
    const f = FIELDS.landedCostManagement;
    moveBodyFieldBefore(form, f.selectedPurchaseOrders, f.shipmentNumber);
    moveBodyFieldBefore(form, f.subsidiary, f.selectedPurchaseOrders);
    moveBodyFieldBefore(form, f.vendor, f.subsidiary);
  }

  function moveBodyFieldBefore(form, fieldId, nextFieldId) {
    try {
      const field = form.getField({ id: fieldId });
      form.insertField({ field, nextfield: nextFieldId });
    } catch (error) {
      log.audit({
        title: 'LCM body field order was not changed',
        details: `${fieldId} before ${nextFieldId}: ${error.message || error}`,
      });
    }
  }

  function disableBodyField(form, fieldId) {
    try {
      const field = form.getField({ id: fieldId });
      field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
    } catch (error) {
      log.audit({
        title: 'LCM body field display was not changed',
        details: `${fieldId}: ${error.message || error}`,
      });
    }
  }

  function disableSublistFields(form, sublistId, fieldIds) {
    try {
      const sublist = form.getSublist({ id: sublistId });
      fieldIds.forEach((fieldId) => {
        try {
          const field = sublist.getField({ id: fieldId });
          field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
        } catch (fieldError) {
          log.audit({
            title: 'LCM sublist field display was not changed',
            details: `${sublistId}.${fieldId}: ${fieldError.message || fieldError}`,
          });
        }
      });
    } catch (sublistError) {
      log.audit({
        title: 'LCM sublist display was not changed',
        details: `${sublistId}: ${sublistError.message || sublistError}`,
      });
    }
  }

  return { beforeLoad, beforeSubmit, afterSubmit };
});
