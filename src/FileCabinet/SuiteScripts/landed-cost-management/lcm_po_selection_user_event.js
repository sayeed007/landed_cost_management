/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(
  [
    'N/error',
    'N/format',
    'N/log',
    'N/ui/serverWidget',
    './lcm_po_selection_config',
    './lcm_po_selection_lib',
    './lcm_shipment_status_lib',
  ],
  (error, format, log, serverWidget, config, lib, shipmentStatus) => {
  const { FIELDS, SUBLISTS } = config;

  function beforeLoad(context) {
    if (context.type === context.UserEventType.DELETE) return;

    context.form.clientScriptModulePath = './lcm_po_selection_client.js';

    applyInitialShipmentStatus(context);
    showCurrentShipmentStatus(context);
    recalculatePersistedItemValues(context);
    orderHeaderFields(context.form);
    disableBodyField(context.form, FIELDS.landedCostManagement.selectedPurchaseOrders);
    disableBodyField(context.form, FIELDS.landedCostManagement.subsidiary);
    renameSublistFields(context.form, SUBLISTS.lcmLandedCosts, [
      { fieldId: FIELDS.lcmLandedCosts.vendor, label: 'Vendor Name' },
      { fieldId: FIELDS.lcmLandedCosts.targetType, label: 'Document Type' },
      { fieldId: FIELDS.lcmLandedCosts.costItemMap, label: 'LC Cost Category' },
    ]);
    renameSublistFields(context.form, SUBLISTS.lcmItems, [
      { fieldId: FIELDS.lcmItems.billStatus, label: 'Receive Status' },
    ]);
    hideSublistFields(context.form, SUBLISTS.lcmLandedCosts, [
      FIELDS.lcmLandedCosts.parent,
      FIELDS.lcmLandedCosts.billLineType,
      FIELDS.lcmLandedCosts.billType,
      FIELDS.lcmLandedCosts.subsidiary,
      FIELDS.lcmLandedCosts.costCategory,
      FIELDS.lcmLandedCosts.billItem,
      FIELDS.lcmLandedCosts.department,
      FIELDS.lcmLandedCosts.class,
    ]);
    disableSublistFields(context.form, SUBLISTS.lcmItems, [
      FIELDS.lcmItems.purchaseOrder,
      FIELDS.lcmItems.item,
      FIELDS.lcmItems.description,
      FIELDS.lcmItems.expectedQuantityReceipt,
      FIELDS.lcmItems.quantityRemaining,
      FIELDS.lcmItems.billStatus,
      FIELDS.lcmItems.unitType,
      FIELDS.lcmItems.poCurrencyText,
      FIELDS.lcmItems.poRate,
      FIELDS.lcmItems.poValue,
      FIELDS.lcmItems.exchangeRate,
      FIELDS.lcmItems.unitLandedCost,
      FIELDS.lcmItems.totalUnitCost,
      FIELDS.lcmItems.totalValue,
      FIELDS.lcmItems.itemReceipt,
    ]);
    if (hasCreatedItemReceipts(context)) {
      disableSublistFields(context.form, SUBLISTS.lcmItems, [
        FIELDS.lcmItems.quantityReceipt,
        FIELDS.lcmItems.trackItem,
      ]);
    }
    disableSublistFields(context.form, SUBLISTS.lcmLandedCosts, [
      FIELDS.lcmLandedCosts.allocationMethod,
    ]);
    setSublistFieldDefault(context.form, SUBLISTS.lcmLandedCosts, FIELDS.lcmLandedCosts.effectiveDate, todayDateText());

    if (
      context.type === context.UserEventType.CREATE ||
      context.type === context.UserEventType.COPY ||
      context.type === context.UserEventType.EDIT
    ) {
      const poSelectionLocked = isPoSelectionLocked(context);
      context.form.addButton({
        id: 'custpage_lcm_select_receivable_pos',
        label: 'Select Receivable POs',
        functionName: poSelectionLocked ? 'showPoSelectionLockedMessage()' : 'openReceivablePoSelector()',
      });
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
      context.form.addButton({
        id: 'custpage_lcm_recalculate_landed_cost',
        label: 'Recalculate Landed Cost',
        functionName: 'openLcmAllocationRecalculation()',
      });
      context.form.addButton({
        id: 'custpage_lcm_create_item_receipt',
        label: 'Create Item Receipt',
        functionName: 'openLcmItemReceiptPreview()',
      });
    }
  }

  function beforeSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;
    setInitialShipmentStatus(context.newRecord);
    sourceHeaderVendorDefaults(context.newRecord);
    validateSelectedPurchaseOrders(context.newRecord);
    if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.COPY) return;
    if (!context.oldRecord || !context.newRecord.id) return;
    if (!shouldSyncPoItems(context)) return;
    if (!lib.hasCreatedAccountingRows(context.newRecord.id) && !lib.hasCreatedItemReceipts(context.newRecord.id)) return;

    throw error.create({
      name: 'LCM_PO_CHANGE_BLOCKED',
      message: 'Selected Purchase Orders cannot be changed after LCM accounting or an Item Receipt has been created.',
      notifyOff: false,
    });
  }

  function afterSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;

    const parentId = context.newRecord.id;
    if (shouldSyncPoItems(context)) {
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

    refreshShipmentStatus(parentId);
  }

  function showCurrentShipmentStatus(context) {
    if (!context.newRecord.id) return;
    if (context.type !== context.UserEventType.VIEW && context.type !== context.UserEventType.EDIT) return;

    try {
      const summary = shipmentStatus.recalculate(context.newRecord.id);
      if (summary.statusValue) {
        context.newRecord.setValue({
          fieldId: FIELDS.landedCostManagement.shipmentStatus,
          value: summary.statusValue,
        });
      } else if (summary.statusText) {
        context.newRecord.setText({
          fieldId: FIELDS.landedCostManagement.shipmentStatus,
          text: summary.statusText,
        });
      }
    } catch (error) {
      log.audit({
        title: 'LCM Shipment Status display refresh skipped',
        details: error.message || error,
      });
    }
  }

  function applyInitialShipmentStatus(context) {
    if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.COPY) return;

    const fieldId = FIELDS.landedCostManagement.shipmentStatus;
    const statusText = config.DEFAULTS.shipmentStatusText;
    try {
      if (!context.newRecord.getValue({ fieldId })) {
        context.newRecord.setText({ fieldId, text: statusText });
      }
    } catch (recordError) {
      log.audit({
        title: 'LCM initial Shipment Status record default skipped',
        details: recordError.message || recordError,
      });
    }

    try {
      const field = context.form.getField({ id: fieldId });
      field.defaultValue = statusText;
    } catch (formError) {
      log.audit({
        title: 'LCM initial Shipment Status form default skipped',
        details: formError.message || formError,
      });
    }
  }

  function setInitialShipmentStatus(rec) {
    try {
      if (rec.getValue({ fieldId: FIELDS.landedCostManagement.shipmentStatus })) return;
      rec.setText({
        fieldId: FIELDS.landedCostManagement.shipmentStatus,
        text: config.DEFAULTS.shipmentStatusText,
      });
    } catch (error) {
      log.audit({
        title: 'LCM initial Shipment Status was not applied',
        details: error.message || error,
      });
    }
  }

  function refreshShipmentStatus(parentId) {
    const summary = shipmentStatus.recalculate(parentId);
    if (summary.updated) {
      log.audit({ title: 'LCM Shipment Status updated', details: summary });
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
        message: 'Select Purchase Order Vendor before selecting Purchase Orders.',
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

  function isPoSelectionLocked(context) {
    if (!context.newRecord.id) return false;
    try {
      return lib.hasCreatedAccountingRows(context.newRecord.id) || lib.hasCreatedItemReceipts(context.newRecord.id);
    } catch (error) {
      log.audit({
        title: 'LCM PO selector lock check failed',
        details: error.message || error,
      });
      return false;
    }
  }

  function hasCreatedItemReceipts(context) {
    if (!context.newRecord.id) return false;
    try {
      return lib.hasCreatedItemReceipts(context.newRecord.id);
    } catch (error) {
      log.audit({
        title: 'LCM Item Receipt lock check failed',
        details: error.message || error,
      });
      return false;
    }
  }

  function recalculatePersistedItemValues(context) {
    if (!context.newRecord.id) return;
    if (context.type !== context.UserEventType.VIEW && context.type !== context.UserEventType.EDIT) return;
    try {
      const summary = lib.recalculatePersistedItemValues(context.newRecord.id);
      if (summary.updatedCount) {
        log.audit({ title: 'LCM item derived values recalculated before load', details: summary });
      }
    } catch (error) {
      log.audit({
        title: 'LCM item derived value recalculation skipped',
        details: error.message || error,
      });
    }
  }

  function orderHeaderFields(form) {
    const f = FIELDS.landedCostManagement;
    moveBodyFieldBefore(form, f.selectedPurchaseOrders, f.shipmentStatus);
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
    updateSublistFieldDisplay(form, sublistId, fieldIds, serverWidget.FieldDisplayType.DISABLED);
  }

  function setSublistFieldDefault(form, sublistId, fieldId, value) {
    if (!value) return;
    try {
      const sublist = form.getSublist({ id: sublistId });
      const field = sublist.getField({ id: fieldId });
      field.defaultValue = value;
    } catch (error) {
      log.audit({
        title: 'LCM sublist field default was not applied',
        details: `${sublistId}.${fieldId}: ${error.message || error}`,
      });
    }
  }

  function todayDateText() {
    return format.format({
      value: new Date(),
      type: format.Type.DATE,
    });
  }

  function hideSublistFields(form, sublistId, fieldIds) {
    updateSublistFieldDisplay(form, sublistId, fieldIds, serverWidget.FieldDisplayType.HIDDEN);
  }

  function renameSublistFields(form, sublistId, fieldLabels) {
    try {
      const sublist = form.getSublist({ id: sublistId });
      fieldLabels.forEach((fieldLabel) => {
        try {
          const field = sublist.getField({ id: fieldLabel.fieldId });
          field.label = fieldLabel.label;
        } catch (fieldError) {
          log.audit({
            title: 'LCM sublist field label was not changed',
            details: `${sublistId}.${fieldLabel.fieldId}: ${fieldError.message || fieldError}`,
          });
        }
      });
    } catch (sublistError) {
      log.audit({
        title: 'LCM sublist label changes were not applied',
        details: `${sublistId}: ${sublistError.message || sublistError}`,
      });
    }
  }

  function updateSublistFieldDisplay(form, sublistId, fieldIds, displayType) {
    try {
      const sublist = form.getSublist({ id: sublistId });
      fieldIds.forEach((fieldId) => {
        try {
          const field = sublist.getField({ id: fieldId });
          field.updateDisplayType({ displayType });
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
