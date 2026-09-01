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

    try {
      const itemSublist = context.form.getSublist({ id: SUBLISTS.lcmItems });
      const poField = itemSublist.getField({ id: FIELDS.lcmItems.purchaseOrder });
      poField.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
    } catch (error) {
      log.audit({
        title: 'LCM line PO display was not changed',
        details: error.message || error,
      });
    }

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

    try {
      const summary = lib.syncPersistedItems(parentId, selectedPoIds);
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

  function normalizeSelection(value) {
    return lib.normalizeIds(value).sort().join(',');
  }

  return { beforeLoad, beforeSubmit, afterSubmit };
});
