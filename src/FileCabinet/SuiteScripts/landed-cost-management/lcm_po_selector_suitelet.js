/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/log', 'N/ui/serverWidget', './lcm_po_selection_lib'], (log, serverWidget, lib) => {
  function onRequest(context) {
    try {
      renderSelector(context);
    } catch (error) {
      log.error({ title: 'LCM receivable PO selector failed', details: error });
      renderError(context, error);
    }
  }

  function renderSelector(context) {
    const vendorId = context.request.parameters.vendorId || '';
    const selectedPoIds = lib.normalizeIds(context.request.parameters.selectedPoIds || '');
    const selectedLookup = selectedPoIds.reduce((memo, poId) => {
      memo[poId] = true;
      return memo;
    }, {});
    const options = vendorId ? lib.listReceivablePurchaseOrders(vendorId) : [];
    const form = serverWidget.createForm({ title: 'Select Receivable Purchase Orders' });

    addHtml(
      form,
      buildSelectorHtml({
        vendorId,
        selectedLookup,
        options,
      })
    );
    context.response.writePage(form);
  }

  function buildSelectorHtml(context) {
    const rows = context.options.map((option) => {
      const checked = context.selectedLookup[option.poId] ? ' checked' : '';
      return `
        <tr>
          <td><input type="checkbox" class="lcm-po-option" value="${escapeHtml(option.poId)}"${checked}></td>
          <td>${escapeHtml(option.poNumber)}</td>
          <td>${escapeHtml(option.transactionDate)}</td>
          <td>${escapeHtml(option.status)}</td>
          <td class="numeric">${escapeHtml(option.receivableLineCount)}</td>
          <td class="numeric">${escapeHtml(option.receivableQuantity)}</td>
        </tr>
      `;
    });

    const body = context.vendorId
      ? buildOptionsBody(rows)
      : '<div class="empty">Select Purchase Order Vendor on the Landed Cost Management record first.</div>';

    return `
      <style>
        body { font-family: Arial, sans-serif; color: #1f2937; }
        .lcm-selector { padding: 14px 0 28px; }
        .toolbar { align-items: center; display: flex; gap: 8px; justify-content: space-between; margin-bottom: 12px; }
        .actions { display: flex; gap: 8px; }
        .btn { background: #2563eb; border: 1px solid #1d4ed8; color: #fff; cursor: pointer; font-size: 13px; padding: 7px 12px; }
        .btn.secondary { background: #fff; border-color: #9ca3af; color: #111827; }
        .search { border: 1px solid #9ca3af; font-size: 13px; min-width: 260px; padding: 7px 8px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border-bottom: 1px solid #e5e7eb; font-size: 13px; padding: 8px 7px; text-align: left; }
        th { background: #f9fafb; color: #374151; font-weight: 600; }
        .numeric { text-align: right; }
        .empty { background: #f9fafb; border: 1px solid #e5e7eb; padding: 18px; }
        .count { color: #4b5563; font-size: 13px; }
      </style>
      <div class="lcm-selector">
        ${body}
      </div>
      <script>
        (function () {
          function selectedIds() {
            var checked = document.querySelectorAll('.lcm-po-option:checked');
            var ids = [];
            for (var index = 0; index < checked.length; index += 1) {
              ids.push(checked[index].value);
            }
            return ids;
          }
          window.lcmApplySelection = function () {
            if (!window.opener || window.opener.closed || typeof window.opener.lcmApplyReceivablePoSelection !== 'function') {
              alert('Return to the Landed Cost Management record and reopen the selector.');
              return;
            }
            window.opener.lcmApplyReceivablePoSelection(selectedIds());
            window.close();
          };
          window.lcmToggleAll = function (checked) {
            var boxes = document.querySelectorAll('.lcm-po-option');
            for (var index = 0; index < boxes.length; index += 1) {
              if (boxes[index].closest('tr').style.display !== 'none') {
                boxes[index].checked = checked;
              }
            }
          };
          window.lcmFilterRows = function (value) {
            var query = String(value || '').toLowerCase();
            var rows = document.querySelectorAll('tbody tr');
            for (var index = 0; index < rows.length; index += 1) {
              rows[index].style.display = rows[index].innerText.toLowerCase().indexOf(query) >= 0 ? '' : 'none';
            }
          };
        })();
      </script>
    `;
  }

  function buildOptionsBody(rows) {
    if (!rows.length) {
      return '<div class="empty">No purchase orders currently have receivable item lines for this Purchase Order Vendor.</div>';
    }

    return `
      <div class="toolbar">
        <input class="search" type="search" placeholder="Filter purchase orders" oninput="lcmFilterRows(this.value)">
        <div class="actions">
          <button type="button" class="btn secondary" onclick="lcmToggleAll(true)">Select Visible</button>
          <button type="button" class="btn secondary" onclick="lcmToggleAll(false)">Clear Visible</button>
          <button type="button" class="btn secondary" onclick="window.close()">Close</button>
          <button type="button" class="btn" onclick="lcmApplySelection()">Apply Selection</button>
        </div>
      </div>
      <div class="count">${rows.length} receivable purchase order(s)</div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Purchase Order</th>
            <th>Date</th>
            <th>Status</th>
            <th class="numeric">Receivable Lines</th>
            <th class="numeric">Open Qty</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  }

  function addHtml(form, html) {
    const field = form.addField({ id: 'custpage_lcm_po_selector', label: 'Selector', type: serverWidget.FieldType.INLINEHTML });
    field.defaultValue = html;
  }

  function renderError(context, error) {
    const form = serverWidget.createForm({ title: 'Select Receivable Purchase Orders' });
    addHtml(form, `<div style="color:#b91c1c;">${escapeHtml(error.message || error)}</div>`);
    context.response.writePage(form);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { onRequest };
});
