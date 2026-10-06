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
      if (!itemReceiptId) throw new Error('Item Receipt is required.');

      if (context.request.method === 'POST') {
        const parentId = String(context.request.parameters.custpage_lcm_id || '').trim();
        if (!parentId) throw new Error('Select a Landed Cost Management record.');
        accounting.attachLcmToItemReceipt(itemReceiptId, parentId);
        redirect.toRecord({ type: 'itemreceipt', id: itemReceiptId });
        return;
      }

      const result = accounting.listEligibleLcmsForItemReceipt(itemReceiptId);
      renderPicker(context, result);
    } catch (error) {
      renderError(context, error.message || String(error));
    }
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
