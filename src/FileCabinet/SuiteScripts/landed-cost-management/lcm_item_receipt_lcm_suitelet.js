/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/redirect', 'N/ui/serverWidget', './lcm_accounting_lib'], (redirect, serverWidget, accounting) => {
  function onRequest(context) {
    try {
      const itemReceiptId = String(
        context.request.parameters.itemReceiptId || context.request.parameters.custpage_item_receipt_id || ''
      ).trim();
      const purchaseOrderId = String(
        context.request.parameters.purchaseOrderId ||
          context.request.parameters.custpage_purchase_order_key ||
          context.request.parameters.custpage_purchase_order_id ||
          ''
      ).trim();

      if (context.request.method === 'POST') {
        if (context.request.parameters.custpage_action === 'createItemReceipt') {
          const parentId = String(context.request.parameters.custpage_lcm_id || '').trim();
          if (!parentId) throw new Error('Select a Landed Cost Management record.');
          if (!purchaseOrderId) throw new Error('Purchase Order is required.');
          const result = accounting.createItemReceiptFromLcm(parentId, purchaseOrderId);
          redirect.toRecord({ type: 'itemreceipt', id: result.itemReceiptId });
          return;
        }
        if (!itemReceiptId) throw new Error('Item Receipt is required.');
        const parentId = String(context.request.parameters.custpage_lcm_id || '').trim();
        if (!parentId) throw new Error('Select a Landed Cost Management record.');
        accounting.attachLcmToItemReceipt(itemReceiptId, parentId);
        redirect.toRecord({ type: 'itemreceipt', id: itemReceiptId });
        return;
      }

      if (purchaseOrderId) {
        const result = accounting.listEligibleLcmsForPurchaseOrder(purchaseOrderId);
        renderCreatePicker(context, result);
      } else {
        if (!itemReceiptId) throw new Error('Item Receipt or Purchase Order is required.');
        const result = accounting.listEligibleLcmsForItemReceipt(itemReceiptId);
        renderPicker(context, result);
      }
    } catch (error) {
      renderError(context, error.message || String(error));
    }
  }

  function renderCreatePicker(context, result) {
    const form = serverWidget.createForm({ title: 'Create Item Receipt from LCM' });
    const purchaseOrder = form.addField({
      id: 'custpage_purchase_order_id',
      label: 'Purchase Order',
      type: serverWidget.FieldType.TEXT,
    });
    purchaseOrder.defaultValue = result.purchaseOrderText || result.purchaseOrderId;
    purchaseOrder.updateDisplayType({ displayType: serverWidget.FieldDisplayType.INLINE });

    const purchaseOrderKey = form.addField({
      id: 'custpage_purchase_order_key',
      label: 'Purchase Order ID',
      type: serverWidget.FieldType.TEXT,
    });
    purchaseOrderKey.defaultValue = result.purchaseOrderId;
    purchaseOrderKey.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

    const select = form.addField({
      id: 'custpage_lcm_id',
      label: 'Landed Cost Management',
      type: serverWidget.FieldType.SELECT,
    });
    select.isMandatory = true;
    select.addSelectOption({ value: '', text: '-- Select --' });
    (result.rows || []).forEach((row) => {
      select.addSelectOption({
        value: String(row.id),
        text: `${row.name} | ${row.shipmentStatusText} | ${row.vendorText || 'Vendor unavailable'}`,
      });
    });

    const action = form.addField({
      id: 'custpage_action',
      label: 'Action',
      type: serverWidget.FieldType.TEXT,
    });
    action.defaultValue = 'createItemReceipt';
    action.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

    const info = form.addField({
      id: 'custpage_lcm_ir_info',
      label: ' ',
      type: serverWidget.FieldType.INLINEHTML,
    });
    info.defaultValue = `<p>Items and receipt quantities will be taken from the selected LCM Items sublist. The Item Receipt will be created from this Purchase Order; no saved receipt edit or manual line copying is required.</p>${
      result.rows.length
        ? '<p>Select the LCM record, then create the receipt.</p>'
        : '<p style="color:#b00020">No eligible Import Landed Cost Management record is available for this Purchase Order.</p>'
    }`;

    if (result.rows.length) form.addSubmitButton({ label: 'Create Item Receipt' });
    context.response.writePage(form);
  }

  function renderPicker(context, result) {
    const form = serverWidget.createForm({ title: 'Select Landed Cost Management' });
    const receiptId = form.addField({
      id: 'custpage_item_receipt_id',
      label: 'Item Receipt',
      type: serverWidget.FieldType.TEXT,
    });
    receiptId.defaultValue = result.itemReceiptId;
    receiptId.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

    const select = form.addField({
      id: 'custpage_lcm_id',
      label: 'Landed Cost Management',
      type: serverWidget.FieldType.SELECT,
    });
    select.isMandatory = true;
    select.addSelectOption({ value: '', text: '-- Select --' });
    (result.rows || []).forEach((row) => {
      select.addSelectOption({
        value: String(row.id),
        text: `${row.name} | ${row.shipmentStatusText} | ${row.vendorText || 'Vendor unavailable'}`,
      });
    });

    const info = form.addField({
      id: 'custpage_lcm_ir_info',
      label: ' ',
      type: serverWidget.FieldType.INLINEHTML,
    });
    info.defaultValue = `<p>Purchase Order: <b>${escapeHtml(result.purchaseOrderText)}</b></p>${
      result.rows.length
        ? '<p>Select an eligible Import Landed Cost Management record. The Item Receipt lines and landed-cost values will be validated before linking.</p>'
        : '<p style="color:#b00020">No eligible Landed Cost Management record is available for this Item Receipt.</p>'
    }`;

    if (result.rows.length) form.addSubmitButton({ label: 'Link Landed Cost Management' });
    context.response.writePage(form);
  }

  function renderError(context, message) {
    const form = serverWidget.createForm({ title: 'LCM Item Receipt Link' });
    const field = form.addField({
      id: 'custpage_lcm_ir_error',
      label: 'Validation',
      type: serverWidget.FieldType.INLINEHTML,
    });
    field.defaultValue = `<div style="color:#b00020;white-space:pre-wrap">${escapeHtml(message)}</div>`;
    context.response.writePage(form);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { onRequest };
});
