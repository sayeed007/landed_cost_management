/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/ui/serverWidget', 'N/url', './lcm_po_selection_config', './lcm_accounting_lib'], (
  error,
  serverWidget,
  url,
  config,
  accounting
) => {
  const { TRANSACTION_FIELDS } = config;

  function beforeLoad(context) {
    if (!context.form || !context.newRecord) return;

    const state = accounting.getItemReceiptLinkState(context.newRecord);
    if (state.parentId || state.sourceKey) {
      disableManagedFields(context.form);
      hideBulkReceiveButton(context.form);
      addStatus(context.form, 'This Item Receipt is controlled by Landed Cost Management. LCM-controlled changes are locked.');
      return;
    }

    const receiptId = String(context.newRecord.id || '').trim();
    const purchaseOrderId = String(context.newRecord.getValue({ fieldId: 'createdfrom' }) || '').trim();
    if (!purchaseOrderId) return;

    if (!receiptId && context.type === context.UserEventType.CREATE) {
      const link = url.resolveScript({
        scriptId: config.SCRIPTS.itemReceiptLcmSuitelet.scriptId,
        deploymentId: config.SCRIPTS.itemReceiptLcmSuitelet.deploymentId,
        params: { purchaseOrderId },
      });
      context.form.addButton({
        id: 'custpage_lcm_ir_create_receipt',
        label: 'Create Item Receipt from LCM',
        functionName: `window.location.assign.bind(window.location, '${escapeJavaScript(link)}')`,
      });
    }
  }

  function beforeSubmit(context) {
    try {
      accounting.validateManagedItemReceipt(
        context.newRecord,
        context.oldRecord,
        String(context.type || '').toLowerCase()
      );
    } catch (validationError) {
      throw error.create({
        name: 'LCM_ITEM_RECEIPT_VALIDATION',
        message: validationError.message || String(validationError),
        notifyOff: false,
      });
    }
  }

  function disableManagedFields(form) {
    ['itemreceive', 'item', 'quantity', 'location'].forEach((fieldId) => disableSublistField(form, 'item', fieldId));
    [TRANSACTION_FIELDS.itemReceipt.landedCostMethod].forEach((fieldId) => disableBodyField(form, fieldId));

    try {
      (form.getFields() || [])
        .filter((fieldId) => /^landedcost(?:source|amount|category)/i.test(String(fieldId)))
        .forEach((fieldId) => disableBodyField(form, fieldId));
    } catch (ignored) {
      // Server validation remains authoritative if a form field is unavailable.
    }
  }

  function disableBodyField(form, fieldId) {
    try {
      const field = form.getField({ id: fieldId });
      field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
    } catch (ignored) {
      // Some account forms omit optional landed-cost fields.
    }
  }

  function disableSublistField(form, sublistId, fieldId) {
    try {
      const field = form.getSublist({ id: sublistId }).getField({ id: fieldId });
      field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.DISABLED });
    } catch (ignored) {
      // Server validation remains authoritative for fields NetSuite does not expose.
    }
  }

  function hideBulkReceiveButton(form) {
    try {
      const button = form.getButton({ id: 'custpage_bulk_receive_all' });
      if (button) button.isHidden = true;
    } catch (ignored) {
      // The independent bulk script may not have added its button yet.
    }
  }

  function addStatus(form, message) {
    try {
      const field = form.addField({
        id: 'custpage_lcm_ir_status',
        label: 'Landed Cost Management',
        type: serverWidget.FieldType.INLINEHTML,
      });
      field.defaultValue = `<div style="padding:6px 0;color:#555">${escapeHtml(message)}</div>`;
    } catch (ignored) {
      // Do not block the native form when an account form already has this field.
    }
  }

  function escapeJavaScript(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n');
  }

  return { beforeLoad, beforeSubmit };
});
