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
        if (context.request.parameters.custpage_action === 'reviewItemReceipt') {
          const parentId = String(context.request.parameters.custpage_lcm_id || '').trim();
          if (!parentId) throw new Error('Select a Landed Cost Management record.');
          if (!purchaseOrderId) throw new Error('Purchase Order is required.');
          const preview = accounting.buildItemReceiptPreview(parentId);
          const result = accounting.listEligibleLcmsForPurchaseOrder(purchaseOrderId);
          renderCreatePicker(context, result, parentId, preview);
          return;
        }
        if (context.request.parameters.custpage_action === 'createItemReceipt') {
          const parentId = String(context.request.parameters.custpage_lcm_id || '').trim();
          if (!parentId) throw new Error('Select a Landed Cost Management record.');
          if (!purchaseOrderId) throw new Error('Purchase Order is required.');
          const result = accounting.createItemReceiptFromLcm(
            parentId,
            purchaseOrderId,
            readItemReceiptInputs(context.request)
          );
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

  function renderCreatePicker(context, result, selectedLcmId, preview) {
    const form = serverWidget.createForm({ title: 'Create Item Receipt from LCM' });
    form.clientScriptModulePath = './lcm_item_receipt_lcm_client.js';
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
    if (selectedLcmId && !(result.rows || []).some((row) => String(row.id) === String(selectedLcmId))) {
      select.addSelectOption({ value: String(selectedLcmId), text: `Selected LCM ${selectedLcmId}` });
    }
    select.defaultValue = selectedLcmId || '';

    const action = form.addField({
      id: 'custpage_action',
      label: 'Action',
      type: serverWidget.FieldType.TEXT,
    });
    action.defaultValue = preview ? 'createItemReceipt' : 'reviewItemReceipt';
    action.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });

    const info = form.addField({
      id: 'custpage_lcm_ir_info',
      label: ' ',
      type: serverWidget.FieldType.INLINEHTML,
    });
    const group = preview && (preview.groups || []).find((entry) => String(entry.purchaseOrderId) === String(result.purchaseOrderId));
    const rows = group && group.action === 'Create' ? group.rows || [] : [];
    info.defaultValue = preview
      ? `<p>Receipt details for <b>${escapeHtml(group ? group.purchaseOrderText : result.purchaseOrderText || result.purchaseOrderId)}</b>. Values are prefilled from the selected LCM and automatic defaults. You may change them before creating the receipt.</p>${
          preview.errors.length
            ? `<div style="color:#b00020;white-space:pre-wrap">${escapeHtml(preview.errors.join('\n'))}</div>`
            : ''
        }`
      : `<p>Items and receipt quantities will be taken from the selected LCM Items sublist. The Item Receipt will be created from this Purchase Order; no saved receipt edit or manual line copying is required.</p>${
          result.rows.length
            ? '<p>Select the LCM record to load its receipt details.</p>'
            : '<p style="color:#b00020">No eligible Import Landed Cost Management record is available for this Purchase Order.</p>'
        }`;

    if (preview) {
      addReceiptDetailsTable(form, rows, preview.inventoryDetailRequirements || []);
      if (!preview.errors.length && rows.length) form.addSubmitButton({ label: 'Create Item Receipt' });
    } else if (result.rows.length) {
      form.addSubmitButton({ label: 'Continue' });
    }
    context.response.writePage(form);
  }

  function addReceiptDetailsTable(form, rows, requirements) {
    if (!rows.length) return;
    const requirementsByItem = {};
    requirements.forEach((requirement) => {
      requirementsByItem[String(requirement.lcmItemId)] = requirement;
    });
    addHidden(form, 'custpage_lcm_receipt_item_ids', rows.map((row) => row.id).join(','));
    const locations = accounting.listReceivingLocations();
    const tableRows = rows.map((row) => {
      const requirement = requirementsByItem[String(row.id)] || {};
      const suffix = String(row.id);
      const locationValue = row.receivingLocation || '';
      const locationOptions = renderOptions(locations, locationValue, 'Current location');
      const lotSerialValue = row.receiptInventoryNumber || requirement.autoReceiptInventoryNumber || '';
      const binValue = row.receivingBinNumber || requirement.defaultBinNumber || requirement.sourcedBinNumber || '';
      const availableBins = accounting.listReceivingBins(row.receivingLocation);
      const binControl = availableBins.length
        ? `<select name="custpage_lcm_rcv_bin_${suffix}"><option value="">-- Optional --</option>${renderOptions(availableBins, binValue, 'Default')}</select>`
        : `<input type="text" name="custpage_lcm_rcv_bin_${suffix}" value="${escapeHtml(binValue)}" placeholder="Internal ID" />`;
      const itemText = escapeHtml(row.itemText || row.itemId || 'Item');
      const receivableText = row.expectedQuantityReceipt === null || row.expectedQuantityReceipt === undefined ? '-' : row.expectedQuantityReceipt;
      const receivedText = row.quantity === null || row.quantity === undefined ? '-' : row.quantity;
      return `<tr><td>${itemText}</td><td class="lcm-receipt-quantity">${escapeHtml(receivableText)}</td><td class="lcm-receipt-quantity">${escapeHtml(receivedText)}</td><td><select name="custpage_lcm_rcv_loc_${suffix}">${locationOptions}</select></td><td><input type="text" name="custpage_lcm_rcv_lot_${suffix}" value="${escapeHtml(lotSerialValue)}" /></td><td>${binControl}</td></tr>`;
    });
    const table = `<style>
      .lcm-receipt-table { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:12px; }
      .lcm-receipt-table th, .lcm-receipt-table td { border:1px solid #c7cdd3; padding:8px; text-align:left; vertical-align:middle; }
      .lcm-receipt-table th { background:#e8edd9; color:#24313a; font-weight:600; }
      .lcm-receipt-table tbody tr:nth-child(even) { background:#f5f7f8; }
      .lcm-receipt-table tbody tr:hover { background:#eef4e2; }
      .lcm-receipt-table th:nth-child(1) { width:17%; }
      .lcm-receipt-table th:nth-child(2) { width:10%; }
      .lcm-receipt-table th:nth-child(3) { width:10%; }
      .lcm-receipt-table th:nth-child(4) { width:25%; }
      .lcm-receipt-table th:nth-child(5) { width:25%; }
      .lcm-receipt-table th:nth-child(6) { width:13%; }
      .lcm-receipt-table select, .lcm-receipt-table input { box-sizing:border-box; width:100%; min-height:30px; padding:5px 7px; border:1px solid #aeb7bf; background:#fff; }
      .lcm-receipt-quantity { text-align:center; white-space:nowrap; }
      .lcm-receipt-table td:first-child { overflow-wrap:anywhere; }
    </style><table class="lcm-receipt-table"><thead><tr><th>Item</th><th>Receivable</th><th>Received</th><th>Receiving Location</th><th>Lot/Serial Number</th><th>Bin Number (Optional)</th></tr></thead><tbody>${tableRows.join('')}</tbody></table>`;
    const field = form.addField({ id: 'custpage_lcm_receipt_details', label: ' ', type: serverWidget.FieldType.INLINEHTML });
    field.defaultValue = table;
  }

  function renderOptions(entries, selectedValue, fallbackLabel) {
    const selected = String(selectedValue || '');
    let found = false;
    const options = (entries || []).map((entry) => {
      const value = String(entry.id || '');
      const isSelected = value === selected;
      if (isSelected) found = true;
      return `<option value="${escapeHtml(value)}"${isSelected ? ' selected' : ''}>${escapeHtml(entry.text || value)}</option>`;
    });
    if (selected && !found) options.unshift(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(`${fallbackLabel} (${selected})`)}</option>`);
    return options.join('');
  }

  function addHidden(form, id, value) {
    const field = form.addField({ id, label: id, type: serverWidget.FieldType.TEXT });
    field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
    field.defaultValue = value || '';
  }

  function readItemReceiptInputs(request) {
    const inputs = {};
    const itemIds = String(request.parameters.custpage_lcm_receipt_item_ids || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    itemIds.forEach((lcmItemId) => {
      if (!lcmItemId) return;
      inputs[String(lcmItemId)] = {
        receivingLocation: request.parameters[`custpage_lcm_rcv_loc_${lcmItemId}`] || '',
        lotSerialNumber: request.parameters[`custpage_lcm_rcv_lot_${lcmItemId}`] || '',
        binNumber: request.parameters[`custpage_lcm_rcv_bin_${lcmItemId}`] || '',
      };
    });
    return inputs;
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
