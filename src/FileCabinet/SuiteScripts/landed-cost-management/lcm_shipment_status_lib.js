/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/log', 'N/record', 'N/search', './lcm_po_selection_config'], (log, record, search, config) => {
  const { RECORDS, FIELDS, SHIPMENT_STATUS } = config;

  function recalculate(parentId) {
    const id = String(parentId || '');
    if (!id) return { statusText: '', updated: false };

    try {
      const statusText = deriveStatus(id);
      const parent = record.load({
        type: RECORDS.landedCostManagement,
        id,
        isDynamic: false,
      });
      const currentText = getRecordText(parent, FIELDS.landedCostManagement.shipmentStatus);
      const currentValue = getRecordValue(parent, FIELDS.landedCostManagement.shipmentStatus);
      if (normalizeChoice(currentText || currentValue) === normalizeChoice(statusText)) {
        return { statusText, statusValue: currentValue, updated: false };
      }

      parent.setText({
        fieldId: FIELDS.landedCostManagement.shipmentStatus,
        text: statusText,
      });
      const statusValue = getRecordValue(parent, FIELDS.landedCostManagement.shipmentStatus);
      parent.save({ enableSourcing: true, ignoreMandatoryFields: true });
      return { statusText, statusValue, updated: true };
    } catch (error) {
      log.error({
        title: 'LCM Shipment Status recalculation failed',
        details: `Parent ${id}: ${error.message || error}`,
      });
      return { statusText: '', statusValue: '', updated: false, error: error.message || String(error) };
    }
  }

  function deriveStatus(parentId) {
    const landedCostRows = fetchLandedCostRows(parentId);
    if (!landedCostRows.length) return SHIPMENT_STATUS.toBeShipped;

    const billRows = landedCostRows.filter((row) => row.isBill);
    if (!billRows.length || billRows.some((row) => !row.costAllocatedInGrn)) {
      return SHIPMENT_STATUS.inTransit;
    }

    const itemStatuses = fetchItemStatuses(parentId);
    if (!itemStatuses.length || itemStatuses.some((item) => !item.itemReceiptId)) return SHIPMENT_STATUS.inTransit;

    return itemStatuses.every((item) => normalizeChoice(item.status) === 'full')
      ? SHIPMENT_STATUS.received
      : SHIPMENT_STATUS.partiallyReceived;
  }

  function fetchLandedCostRows(parentId) {
    const f = FIELDS.lcmLandedCosts;
    const rows = [];
    search
      .create({
        type: RECORDS.lcmLandedCosts,
        filters: [[f.parent, 'anyof', parentId]],
        columns: [f.targetType, f.createdTransactionType, f.costAllocatedInGrn],
      })
      .run()
      .each((result) => {
        const targetText = getResultText(result, f.targetType);
        const createdType = getResultValue(result, f.createdTransactionType);
        rows.push({
          isBill:
            normalizeChoice(targetText).indexOf('bill') >= 0 ||
            normalizeChoice(createdType).indexOf('vendorbill') >= 0,
          costAllocatedInGrn: isChecked(getResultValue(result, f.costAllocatedInGrn)),
        });
        return true;
      });
    return rows;
  }

  function fetchItemStatuses(parentId) {
    const f = FIELDS.lcmItems;
    const statuses = [];
    search
      .create({
        type: RECORDS.lcmItems,
        filters: [[f.parent, 'anyof', parentId]],
        columns: [f.billStatus, f.itemReceipt],
      })
      .run()
      .each((result) => {
        statuses.push({
          status: getResultValue(result, f.billStatus),
          itemReceiptId: getResultValue(result, f.itemReceipt),
        });
        return true;
      });
    return statuses;
  }

  function isChecked(value) {
    return value === true || value === 'T' || value === 'true' || value === 1 || value === '1';
  }

  function normalizeChoice(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  }

  function getResultValue(result, fieldId) {
    return result.getValue({ name: fieldId }) || '';
  }

  function getResultText(result, fieldId) {
    return result.getText({ name: fieldId }) || '';
  }

  function getRecordValue(rec, fieldId) {
    try {
      return rec.getValue({ fieldId }) || '';
    } catch (error) {
      return '';
    }
  }

  function getRecordText(rec, fieldId) {
    try {
      return rec.getText({ fieldId }) || '';
    } catch (error) {
      return '';
    }
  }

  return { deriveStatus, recalculate };
});
