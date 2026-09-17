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
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'selectedPoDefaults') {
        renderSelectedPoDefaults(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'allocationMethodDefault') {
        renderAllocationMethodDefault(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'costItemMapDefaults') {
        renderCostItemMapDefaults(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'costCategoryItemMatches') {
        renderCostCategoryItemMatches(context);
      } else if (context.request.method === 'GET' && context.request.parameters.action === 'allocationPreview') {
        renderAllocationPreview(context);
      } else if (context.request.method === 'POST') {
        if (context.request.parameters.custpage_action === 'recalculateAllocation') {
          renderAllocationResult(context);
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

  function renderSelectedPoDefaults(context) {
    const poIds = context.request.parameters.poIds || '';
    const payload = {
      ok: Boolean(poIds),
      defaults: poIds ? accounting.getSelectedPurchaseOrderDefaults(poIds) : {},
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

  function renderError(context, error) {
    context.response.write(`
      <html>
        <head><title>LCM Accounting Error</title></head>
        <body style="font-family:Arial,sans-serif;margin:24px;">
          <h2 style="color:#8b0000;">LCM Accounting Error</h2>
          <pre style="white-space:pre-wrap;border:1px solid #ddd;background:#fafafa;padding:12px;">${escapeHtml(getErrorMessage(error))}</pre>
          <p style="color:#666;">Close this window, correct the Landed Cost rows, then run the create action again.</p>
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

  function renderGroups(groups) {
    if (!groups.length) return '';
    const rows = groups
      .map(
        (group) => `<tr>
          <td>${escapeHtml(group.vendorText || '')}</td>
          <td>${escapeHtml(group.subsidiaryText || group.subsidiary || '')}</td>
          <td>${escapeHtml(group.billTypeText || group.billType || '')}</td>
          <td>${escapeHtml(group.currencyText || group.currency || '')}</td>
          <td>${escapeHtml(group.actionText || '')}</td>
          <td>${group.rows.length}</td>
          <td>${group.billLineCount || group.rows.length}</td>
          <td>${group.amount}</td>
        </tr>`
      )
      .join('');
    return `<table class="lcm-table"><thead><tr><th>Vendor</th><th>Subsidiary</th><th>Bill Type</th><th>Currency</th><th>Action</th><th>LCM Rows</th><th>Transaction Lines</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
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
        <p>Processed rows: ${result.processedRowCount}. Allocated landed-cost rows: ${result.allocatedRowCount}. Allocation target item rows: ${result.allocationTargetCount}.</p>
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
