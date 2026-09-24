/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/log', 'N/ui/serverWidget', 'N/url', './lcm_po_selection_config', './lcm_accounting_lib'], (
  log,
  serverWidget,
  url,
  config,
  accounting
) => {

  function onRequest(context) {
    try {
      if (context.request.method === 'GET' && context.request.parameters.action === 'vendorDefaults') {
        renderVendorDefaults(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'vendorCurrencyDefaults') {
        renderVendorCurrencyDefaults(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'allocationMethodDefault') {
        renderAllocationMethodDefault(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'costItemMapDefaults') {
        renderCostItemMapDefaults(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'costCategoryItemMatches') {
        renderCostCategoryItemMatches(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'allocationPreview') {
        renderAllocationPreview(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'itemReceiptPreview') {
        renderItemReceiptPreview(context);
      } else if (context.request.method === 'POST') {
        if (context.request.parameters.custpage_action === 'recalculateAllocation') {
          renderAllocationResult(context);
        } else if (context.request.parameters.custpage_action === 'createItemReceipts') {
          renderItemReceiptResult(context);
        } else {
          renderResult(context);
        }
      } else {
        renderPreview(context);
      }
    } catch (error) {
      log.error({ title: 'LCM accounting Suitelet failed', details: error });
      try {
        renderError(context, error);
      } catch (renderingError) {
        log.error({ title: 'LCM accounting error rendering failed', details: renderingError });
        context.response.write(`LCM Accounting Error: ${escapeHtml(getErrorMessage(error))}`);
      }
    }
  }

  function renderVendorDefaults(context) {
    const vendorId = context.request.parameters.vendorId || '';
    const payload = {
      ok: Boolean(vendorId),
      defaults: vendorId ? accounting.getVendorBillDefaults(vendorId) : {},
    };
    context.response.write(JSON.stringify(payload));
  }

  function renderVendorCurrencyDefaults(context) {
    const vendorId = context.request.parameters.vendorId || '';
    const currencyId = context.request.parameters.currencyId || '';
    const subsidiaryId = context.request.parameters.subsidiaryId || '';
    const payload = {
      ok: Boolean(vendorId && currencyId),
      defaults: vendorId && currencyId ? accounting.getVendorCurrencyDefaults(vendorId, currencyId, subsidiaryId) : {},
    };
    context.response.write(JSON.stringify(payload));
  }

  function renderAllocationMethodDefault(context) {
    const costCategoryId = context.request.parameters.costCategoryId || '';
    const payload = {
      ok: Boolean(costCategoryId),
      defaults: costCategoryId ? accounting.getAllocationMethodDefault(costCategoryId) : {},
    };
    context.response.write(JSON.stringify(payload));
  }

  function renderCostItemMapDefaults(context) {
    const costItemMapId = context.request.parameters.costItemMapId || '';
    const payload = {
      ok: Boolean(costItemMapId),
      defaults: costItemMapId ? accounting.getCostItemMapDefaults(costItemMapId) : {},
    };
    context.response.write(JSON.stringify(payload));
  }

  function renderCostCategoryItemMatches(context) {
    const payload = {
      ok: true,
      matches: accounting.listCostCategoryItemMatches(),
    };
    const callback = sanitizeCallbackName(context.request.parameters.callback || '');
    context.response.write(callback ? `${callback}(${JSON.stringify(payload)});` : JSON.stringify(payload));
  }

  function renderPreview(context) {
    const parentId = context.request.parameters.parentId || '';
    const mode = accounting.normalizeMode(context.request.parameters.mode || 'bill');
    const preview = accounting.buildPreview(parentId, mode);
    const form = serverWidget.createForm({ title: `LCM Create ${preview.modeText}` });

    addHidden(form, 'custpage_parent_id', parentId);
    addHidden(form, 'custpage_mode', mode);
    addHtml(form, renderPreviewHtml(preview));
    if (preview.ok) {
      form.addSubmitButton({ label: `Confirm Create ${preview.modeText}` });
    }

    context.response.writePage(form);
  }

  function renderAllocationPreview(context) {
    const parentId = context.request.parameters.parentId || '';
    const preview = accounting.buildAllocationPreview(parentId);
    const form = serverWidget.createForm({ title: 'LCM Recalculate Landed Cost' });

    addHidden(form, 'custpage_parent_id', parentId);
    addHidden(form, 'custpage_action', 'recalculateAllocation');
    addHtml(form, renderAllocationPreviewHtml(preview));
    if (preview.ok) {
      form.addSubmitButton({ label: 'Confirm Recalculate Landed Cost' });
    }

    context.response.writePage(form);
  }

  function renderItemReceiptPreview(context) {
    const parentId = context.request.parameters.parentId || '';
    const preview = accounting.buildItemReceiptPreview(parentId);
    const form = serverWidget.createForm({ title: 'LCM Create Item Receipts' });

    addHidden(form, 'custpage_parent_id', parentId);
    addHidden(form, 'custpage_action', 'createItemReceipts');
    addHtml(form, renderItemReceiptPreviewHtml(preview));
    if (preview.ok) {
      form.addSubmitButton({ label: 'Confirm Create Item Receipts' });
    }

    context.response.writePage(form);
  }

  function renderResult(context) {
    const parentId = context.request.parameters.custpage_parent_id || '';
    const mode = accounting.normalizeMode(context.request.parameters.custpage_mode || 'bill');
    const result = accounting.createTransactions(parentId, mode);
    const form = serverWidget.createForm({ title: `LCM ${result.modeText} Processed` });
    addHtml(form, renderResultHtml(result, parentRecordUrl(parentId)));
    context.response.writePage(form);
  }

  function renderAllocationResult(context) {
    const parentId = context.request.parameters.custpage_parent_id || '';
    const result = accounting.recalculateAllocatedCosts(parentId);
    const form = serverWidget.createForm({ title: 'LCM Landed Cost Recalculated' });
    addHtml(form, renderResultHtml(result, parentRecordUrl(parentId)));
    context.response.writePage(form);
  }

  function renderItemReceiptResult(context) {
    const parentId = context.request.parameters.custpage_parent_id || '';
    const result = accounting.createItemReceipts(parentId);
    const form = serverWidget.createForm({ title: 'LCM Item Receipts Processed' });
    addHtml(form, renderResultHtml(result, parentRecordUrl(parentId)));
    context.response.writePage(form);
  }

  function renderError(context, error) {
    context.response.write(`
      <html>
        <head><title>LCM Accounting Error</title></head>
        <body style="font-family:Arial,sans-serif;margin:24px;">
          <h2 style="color:#8b0000;">LCM Accounting Error</h2>
          <pre style="white-space:pre-wrap;border:1px solid #ddd;background:#fafafa;padding:12px;">${escapeHtml(getErrorMessage(error))}</pre>
          <p style="color:#666;">Close this window, correct the missing receipt or Landed Cost data, then run the create action again.</p>
        </body>
      </html>
    `);
  }

  function renderPreviewHtml(preview) {
    return `
      <style>
        .lcm-box{font-family:Arial,sans-serif;margin:12px 0;}
        .lcm-table{border-collapse:collapse;width:100%;margin:12px 0;}
        .lcm-table th,.lcm-table td{border:1px solid #ddd;padding:6px 8px;text-align:left;}
        .lcm-table th{background:#f4f4f4;}
        .lcm-error{color:#8b0000;font-weight:600;}
        .lcm-muted{color:#666;}
      </style>
      <div class="lcm-box">
        <h3>Preview ${escapeHtml(preview.modeText)} Creation</h3>
        <p>Eligible rows: ${preview.eligibleRows.length}. Skipped rows: ${preview.skippedRows.length}. Transaction groups: ${preview.groups.length}. Allocation target item rows: ${preview.allocationTargetCount}.</p>
        ${preview.errors.length ? `<div class="lcm-error">${preview.errors.map(escapeHtml).join('<br>')}</div>` : ''}
        ${renderGroups(preview.groups)}
        ${renderBillLines(preview.groups)}
        ${renderSkipped(preview.skippedRows)}
        <p class="lcm-muted">Close this window without confirming if the preview is not correct.</p>
      </div>
    `;
  }

  function renderAllocationPreviewHtml(preview) {
    return `
      ${sharedStyles()}
      <div class="lcm-box">
        <h3>Preview Landed Cost Recalculation</h3>
        <p>Created Bill rows: ${preview.createdBillRows.length}. Pending allocation rows: ${preview.unallocatedCreatedRows.length}. Allocation target item rows: ${preview.allocationTargetCount}.</p>
        ${preview.errors.length ? `<div class="lcm-error">${preview.errors.map(escapeHtml).join('<br>')}</div>` : ''}
        <p class="lcm-muted">This action does not create or append Vendor Bills. It recalculates item landed cost fresh from all created Bill-type Landed Cost rows on this LCM record.</p>
        <p class="lcm-muted">Close this window without confirming if the preview is not correct.</p>
      </div>
    `;
  }

  function renderItemReceiptPreviewHtml(preview) {
    const rows = (preview.groups || [])
      .map((group) => {
        const quantity = (group.rows || []).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
        const costSummary = (group.landedCosts || [])
          .map(
            (entry) =>
              `${escapeHtml(entry.costCategoryText || entry.costCategory || '')}: ${escapeHtml(String(entry.amount || 0))}`
          )
          .join('<br>');
        return `<tr>
          <td>${escapeHtml(group.purchaseOrderText || group.purchaseOrderId || '')}</td>
          <td>${escapeHtml(group.action || '')}</td>
          <td>${(group.rows || []).length}</td>
          <td>${escapeHtml(String(quantity))}</td>
          <td>${escapeHtml(group.currencyText || '')}</td>
          <td>${escapeHtml(String(group.baseLandedCostAmount || 0))}</td>
          <td>${costSummary || '-'}</td>
        </tr>`;
      })
      .join('');
    return `
      ${sharedStyles()}
      <div class="lcm-box">
        <h3>Preview Item Receipt Creation</h3>
        <p>PO receipts: ${(preview.groups || []).length}. Item rows: ${(preview.receiptItems || []).length}. Allocation target item rows: ${preview.allocationTargetCount}. Created Bill rows: ${(preview.createdBillRows || []).length}. Inventory Detail item rows: ${(preview.inventoryDetailRequirements || []).length}.</p>
        ${preview.errors.length ? `<div class="lcm-error">${preview.errors.map(escapeHtml).join('<br>')}</div>` : ''}
        ${rows ? `<table class="lcm-table"><thead><tr><th>Purchase Order</th><th>Action</th><th>Item Rows</th><th>Receive Qty</th><th>PO Currency</th><th>Base Landed Cost</th><th>Manual Landed Cost by Category</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
        <p class="lcm-muted">Each receipt is transformed from its Purchase Order. LCM Items are linked to the resulting GRN. A Bill spanning several POs is allocated as Manual landed cost per receipt because NetSuite permits an Other Transaction Bill source on only one Item Receipt.</p>
        ${renderInventoryDetailRequirements(preview.inventoryDetailRequirements || [])}
        ${(preview.inventoryDetailRequirements || []).length ? '<p class="lcm-muted">Inventory Detail is created automatically. Lot-numbered items use a Receipt Inventory Number based on the LCM Shipment Number and item. Serial-numbered items remain blocked because real physical serial numbers cannot be generated by the system.</p>' : ''}
        <p class="lcm-muted">Close this window without confirming if the preview is not correct.</p>
      </div>
    `;
  }

  function renderGroups(groups) {
    if (!groups.length) return '';
    const rows = groups
      .map(
        (group) => `<tr>
          <td>${escapeHtml(group.vendorText || '')}</td>
          <td>${escapeHtml(group.subsidiaryText || group.subsidiary || '')}</td>
          <td>${escapeHtml(group.billTypeText || group.billType || '')}</td>
          <td>${escapeHtml(group.currencyText || group.currency || '')}</td>
          <td>${escapeHtml(group.routeText || '')}</td>
          <td>${escapeHtml(group.actionText || '')}</td>
          <td>${group.rows.length}</td>
          <td>${group.billLineCount || group.rows.length}</td>
          <td>${group.amount}</td>
        </tr>`
      )
      .join('');
    return `<table class="lcm-table"><thead><tr><th>Vendor</th><th>Subsidiary</th><th>Bill Type</th><th>Currency</th><th>Routing</th><th>Action</th><th>LCM Rows</th><th>Transaction Lines</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderInventoryDetailRequirements(requirements) {
    if (!requirements.length) return '';
    const rows = requirements
      .map(
        (requirement) => `<tr>
          <td>${escapeHtml(requirement.purchaseOrderText || requirement.purchaseOrderId || '')}</td>
          <td>${escapeHtml(requirement.itemText || requirement.itemId || '')}</td>
          <td>${escapeHtml(String(requirement.requiredQuantity || 0))}</td>
          <td>${escapeHtml(inventoryRequirementText(requirement))}</td>
        </tr>`
      )
      .join('');
    return `<h4>Inventory Detail Automation</h4><table class="lcm-table"><thead><tr><th>Purchase Order</th><th>Item</th><th>LCM Receipt Qty</th><th>Automatic Assignment</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // One row per Vendor Bill line that would be written, with the Landed Cost rows behind it.
  // Two lines where one was expected is answered here: compare the LC Cost Category, LC Cost
  // Item and Allocation Method, which together decide whether rows merge.
  function renderBillLines(groups) {
    const rows = (groups || [])
      .reduce((all, group) => all.concat(group.billLines || []), [])
      .map(
        (line) => `<tr>
          <td>${escapeHtml((line.sourceRowIds || []).join(', '))}</td>
          <td>${escapeHtml(line.costCategoryText)}</td>
          <td>${escapeHtml(line.billItemText)}</td>
          <td>${escapeHtml(line.allocationMethodText)}</td>
          <td>1</td>
          <td>${escapeHtml(String(line.amount))}</td>
          <td>${escapeHtml(line.routeText || '')}</td>
          <td>${escapeHtml(line.action || 'New Vendor Bill')}</td>
        </tr>`
      )
      .join('');
    if (!rows) return '';

    // When a line will not merge, the two markers side by side are the whole explanation.
    const mismatches = (groups || [])
      .reduce((all, group) => all.concat(group.billLines || []), [])
      .filter((line) => line.willAddNewLine && line.expectedSourceKey)
      .map(
        (line) =>
          `<li>Looking for <code>${escapeHtml(line.expectedSourceKey)}</code><br>${
            (line.diagnostics || [])
              .map((entry) => escapeHtml(entry))
              .join('<br>')
          }</li>`
      )
      .join('');

    return `<h4>Vendor Bill lines to be written</h4><table class="lcm-table"><thead><tr><th>From LCM Rows</th><th>LC Cost Category</th><th>LC Cost Item</th><th>Allocation Method</th><th>Qty</th><th>Amount</th><th>Routing</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>${
      mismatches
        ? `<h4>Why these lines will not merge</h4><p class="lcm-muted">A line merges into an existing one only when that line carries the same LCM Source Key and still holds the same item. This is what the matcher saw on the Bill, line by line.</p><ul>${mismatches}</ul>`
        : ''
    }`;
  }

  function renderSkipped(skippedRows) {
    if (!skippedRows.length) return '';
    const rows = skippedRows
      .map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.reason)}</td></tr>`)
      .join('');
    return `<h4>Skipped Rows</h4><table class="lcm-table"><thead><tr><th>Line ID</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderResultHtml(result, backUrl) {
    const rows = result.created
      .map(
        (tran) => `<tr>
          <td>${escapeHtml(tran.label)}</td>
          <td>${escapeHtml(tran.action || 'Created')}</td>
          <td>${escapeHtml(tran.id)}</td>
          <td>${escapeHtml(tran.tranid || tran.id)}</td>
        </tr>`
      )
      .join('');
    const transactionTable = rows
      ? `<table class="lcm-table"><thead><tr><th>Type</th><th>Action</th><th>Internal ID</th><th>Number</th></tr></thead><tbody>${rows}</tbody></table>`
      : '';
    return `
      ${sharedStyles()}
      <div class="lcm-box">
        <h3>${escapeHtml(result.modeText)} processing complete</h3>
        <p>Processed rows: ${result.processedRowCount}. GRN-allocated landed-cost rows: ${result.allocatedRowCount}. Allocation target item rows: ${result.allocationTargetCount}.</p>
        ${transactionTable}
        ${backUrl ? `<p><a href="${escapeHtml(backUrl)}">Back to Landed Cost Management</a></p>` : ''}
      </div>
    `;
  }

  function sharedStyles() {
    return `
      <style>
        .lcm-box{font-family:Arial,sans-serif;margin:12px 0;}
        .lcm-table{border-collapse:collapse;width:100%;margin:12px 0;}
        .lcm-table th,.lcm-table td{border:1px solid #ddd;padding:6px 8px;text-align:left;}
        .lcm-table th{background:#f4f4f4;}
        .lcm-error{color:#8b0000;font-weight:600;}
        .lcm-muted{color:#666;}
      </style>
    `;
  }

  function parentRecordUrl(parentId) {
    if (!parentId) return '';
    try {
      return url.resolveRecord({
        recordType: config.RECORDS.landedCostManagement,
        recordId: parentId,
        isEditMode: false,
      });
    } catch (error) {
      log.audit({
        title: 'LCM parent record URL was not resolved',
        details: error.message || error,
      });
      return '';
    }
  }

  function addHidden(form, id, value) {
    const field = form.addField({ id, label: id, type: serverWidget.FieldType.TEXT });
    field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
    field.defaultValue = value || '';
  }

  function addHtml(form, html) {
    const field = form.addField({ id: 'custpage_lcm_preview', label: 'Preview', type: serverWidget.FieldType.INLINEHTML });
    field.defaultValue = html;
  }

  function inventoryRequirementText(requirement) {
    const needs = [];
    if (requirement.isSerial) return 'Actual serial numbers are required; automatic receipt is blocked.';
    if (requirement.autoReceiptInventoryNumber) needs.push(`Receipt Inventory Number: ${requirement.autoReceiptInventoryNumber}`);
    if (requirement.requiresBin) {
      needs.push(requirement.sourcedBinNumber ? 'NetSuite-sourced receiving bin' : 'Configured receiving bin fallback');
    }
    if (requirement.requiresInventoryStatus) {
      needs.push(requirement.sourcedInventoryStatus ? 'NetSuite-sourced receiving inventory status' : 'NetSuite default receiving inventory status');
    }
    if (requirement.requiresExpirationDate) needs.push('Expiration Date requires source data');
    if (!needs.length) needs.push('NetSuite sourced Inventory Detail');
    return Array.from(new Set(needs)).join(' + ');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeCallbackName(value) {
    const name = String(value || '');
    return /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(name) ? name : '';
  }

  function getErrorMessage(error) {
    if (!error) return 'Unknown error';
    const parts = [];
    if (error.name) parts.push(error.name);
    if (error.message) parts.push(error.message);
    if (error.details && error.details !== error.message) parts.push(error.details);
    if (!parts.length) parts.push(String(error));
    return parts.join('\n');
  }

  return { onRequest };
});
