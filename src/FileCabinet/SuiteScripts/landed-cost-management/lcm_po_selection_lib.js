/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', './lcm_po_selection_config'], (record, search, config) => {
  const { RECORDS, FIELDS } = config;

  function normalizeIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function makeLineKey(poId, lineUniqueKey, itemId, lineIndex) {
    if (lineUniqueKey) return `${poId}:${lineUniqueKey}`;
    return `${poId}:line:${lineIndex}:item:${itemId || ''}`;
  }

  function fetchPurchaseOrderHeaders(poIds) {
    const headersById = {};

    search
      .create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['internalid', 'anyof', poIds],
          'AND',
          ['mainline', 'is', 'T'],
        ],
        columns: ['internalid', 'tranid', 'entity'],
      })
      .run()
      .each((result) => {
        const poId = String(result.getValue({ name: 'internalid' }) || '');
        headersById[poId] = {
          poId,
          poNumber: String(result.getValue({ name: 'tranid' }) || ''),
          vendorId: String(result.getValue({ name: 'entity' }) || ''),
          vendorText: String(result.getText({ name: 'entity' }) || ''),
        };
        return true;
      });

    return headersById;
  }

  function fetchPurchaseOrderItemLines(poIdsInput) {
    const poIds = normalizeIds(poIdsInput);
    if (!poIds.length) return [];

    const rows = [];
    const headersById = fetchPurchaseOrderHeaders(poIds);
    const poSearch = search.create({
      type: search.Type.PURCHASE_ORDER,
      filters: [
        ['internalid', 'anyof', poIds],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        ['item', 'noneof', '@NONE@'],
      ],
      columns: [
        search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
        'tranid',
        'entity',
        'item',
        'memo',
        'quantity',
        'quantityshiprecv',
        'quantitybilled',
        'rate',
        'unit',
        'exchangerate',
        'lineuniquekey',
      ],
    });

    let lineIndex = 0;
    poSearch.run().each((result) => {
      const poId = String(result.getValue({ name: 'internalid' }) || '');
      const header = headersById[poId] || {};
      const itemId = String(result.getValue({ name: 'item' }) || '');
      const quantity = toNumber(result.getValue({ name: 'quantity' }));
      const quantityReceived = toNumber(result.getValue({ name: 'quantityshiprecv' }));
      const quantityBilled = toNumber(result.getValue({ name: 'quantitybilled' }));
      const lineUniqueKey = String(result.getValue({ name: 'lineuniquekey' }) || '');
      const quantityRemaining =
        quantity === null ? null : quantity - (quantityReceived === null ? 0 : quantityReceived);

      rows.push({
        poId,
        poNumber: header.poNumber || String(result.getValue({ name: 'tranid' }) || ''),
        vendorId: header.vendorId || String(result.getValue({ name: 'entity' }) || ''),
        vendorText: header.vendorText || String(result.getText({ name: 'entity' }) || ''),
        itemId,
        itemText: String(result.getText({ name: 'item' }) || ''),
        description: String(result.getValue({ name: 'memo' }) || ''),
        quantity,
        quantityReceived,
        quantityBilled,
        quantityRemaining,
        poRate: toNumber(result.getValue({ name: 'rate' })),
        unitType: String(result.getText({ name: 'unit' }) || result.getValue({ name: 'unit' }) || ''),
        exchangeRate: String(result.getValue({ name: 'exchangerate' }) || ''),
        lineUniqueKey,
        poLineKey: makeLineKey(poId, lineUniqueKey, itemId, lineIndex),
      });

      lineIndex += 1;
      return true;
    });

    return rows;
  }

  function eachExistingLcmItem(parentId, callback) {
    search
      .create({
        type: RECORDS.lcmItems,
        filters: [[FIELDS.lcmItems.parent, 'anyof', parentId]],
        columns: [
          'internalid',
          FIELDS.lcmItems.vendor,
          FIELDS.lcmItems.purchaseOrder,
          FIELDS.lcmItems.item,
          FIELDS.lcmItems.description,
          FIELDS.lcmItems.quantityReceipt,
          FIELDS.lcmItems.expectedQuantityReceipt,
          FIELDS.lcmItems.quantityRemaining,
          FIELDS.lcmItems.quantityBill,
          FIELDS.lcmItems.unitType,
          FIELDS.lcmItems.poRate,
          FIELDS.lcmItems.exchangeRate,
          FIELDS.lcmItems.trackItem,
          FIELDS.lcmItems.unitLandedCost,
          FIELDS.lcmItems.totalUnitCost,
          FIELDS.lcmItems.poLineKey,
        ],
      })
      .run()
      .each((result) => {
        callback({
          id: String(result.getValue({ name: 'internalid' }) || ''),
          vendorId: String(result.getValue({ name: FIELDS.lcmItems.vendor }) || ''),
          poId: String(result.getValue({ name: FIELDS.lcmItems.purchaseOrder }) || ''),
          itemId: String(result.getValue({ name: FIELDS.lcmItems.item }) || ''),
          description: String(result.getValue({ name: FIELDS.lcmItems.description }) || ''),
          quantity: toNumber(result.getValue({ name: FIELDS.lcmItems.expectedQuantityReceipt })),
          quantityReceived: toNumber(result.getValue({ name: FIELDS.lcmItems.quantityReceipt })),
          quantityRemaining: toNumber(result.getValue({ name: FIELDS.lcmItems.quantityRemaining })),
          quantityBilled: toNumber(result.getValue({ name: FIELDS.lcmItems.quantityBill })),
          unitType: String(result.getValue({ name: FIELDS.lcmItems.unitType }) || ''),
          poRate: toNumber(result.getValue({ name: FIELDS.lcmItems.poRate })),
          exchangeRate: String(result.getValue({ name: FIELDS.lcmItems.exchangeRate }) || ''),
          trackItem: result.getValue({ name: FIELDS.lcmItems.trackItem }) === true || result.getValue({ name: FIELDS.lcmItems.trackItem }) === 'T',
          unitLandedCost: toNumber(result.getValue({ name: FIELDS.lcmItems.unitLandedCost })),
          totalUnitCost: toNumber(result.getValue({ name: FIELDS.lcmItems.totalUnitCost })),
          poLineKey: String(result.getValue({ name: FIELDS.lcmItems.poLineKey }) || ''),
        });
        return true;
      });
  }

  function setIfPresent(rec, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    rec.setValue({ fieldId, value });
  }

  function createLcmItem(parentId, poLine) {
    const rec = record.create({ type: RECORDS.lcmItems, isDynamic: false });

    setIfPresent(rec, FIELDS.lcmItems.parent, parentId);
    setIfPresent(rec, FIELDS.lcmItems.vendor, poLine.vendorId);
    setIfPresent(rec, FIELDS.lcmItems.purchaseOrder, poLine.poId);
    setIfPresent(rec, FIELDS.lcmItems.item, poLine.itemId);
    setIfPresent(rec, FIELDS.lcmItems.description, poLine.description || poLine.itemText);
    setIfPresent(rec, FIELDS.lcmItems.quantityReceipt, poLine.quantityReceived);
    setIfPresent(rec, FIELDS.lcmItems.expectedQuantityReceipt, poLine.quantity);
    setIfPresent(rec, FIELDS.lcmItems.quantityRemaining, poLine.quantityRemaining);
    setIfPresent(rec, FIELDS.lcmItems.quantityBill, poLine.quantityBilled);
    setIfPresent(rec, FIELDS.lcmItems.unitType, poLine.unitType);
    setIfPresent(rec, FIELDS.lcmItems.poRate, poLine.poRate);
    setIfPresent(rec, FIELDS.lcmItems.exchangeRate, poLine.exchangeRate);
    rec.setValue({ fieldId: FIELDS.lcmItems.trackItem, value: false });
    setIfPresent(rec, FIELDS.lcmItems.poLineKey, poLine.poLineKey);

    return rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
  }

  function updateLcmItem(existingRow, poLine) {
    const values = {};

    setChangedValue(values, FIELDS.lcmItems.vendor, existingRow.vendorId, poLine.vendorId);
    setChangedValue(values, FIELDS.lcmItems.purchaseOrder, existingRow.poId, poLine.poId);
    setChangedValue(values, FIELDS.lcmItems.item, existingRow.itemId, poLine.itemId);
    setChangedValue(values, FIELDS.lcmItems.description, existingRow.description, poLine.description || poLine.itemText);
    setChangedValue(values, FIELDS.lcmItems.quantityReceipt, existingRow.quantityReceived, poLine.quantityReceived);
    setChangedValue(values, FIELDS.lcmItems.expectedQuantityReceipt, existingRow.quantity, poLine.quantity);
    setChangedValue(values, FIELDS.lcmItems.quantityRemaining, existingRow.quantityRemaining, poLine.quantityRemaining);
    setChangedValue(values, FIELDS.lcmItems.quantityBill, existingRow.quantityBilled, poLine.quantityBilled);
    setChangedValue(values, FIELDS.lcmItems.unitType, existingRow.unitType, poLine.unitType);
    setChangedValue(values, FIELDS.lcmItems.poRate, existingRow.poRate, poLine.poRate);
    setChangedValue(values, FIELDS.lcmItems.exchangeRate, existingRow.exchangeRate, poLine.exchangeRate);
    setChangedValue(values, FIELDS.lcmItems.poLineKey, existingRow.poLineKey, poLine.poLineKey);

    if (!Object.keys(values).length) return false;

    record.submitFields({
      type: RECORDS.lcmItems,
      id: existingRow.id,
      values,
      options: { enableSourcing: true, ignoreMandatoryFields: true },
    });
    return true;
  }

  function setChangedValue(values, fieldId, existingValue, nextValue) {
    if (nextValue === null || nextValue === undefined || nextValue === '') return;
    if (normalizeComparable(existingValue) === normalizeComparable(nextValue)) return;
    values[fieldId] = nextValue;
  }

  function normalizeComparable(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function loadExistingItemsByKey(parentId) {
    const rowsByKey = {};
    const rowsWithoutKey = [];

    eachExistingLcmItem(parentId, (row) => {
      if (row.poLineKey) {
        if (rowsByKey[row.poLineKey]) {
          rowsWithoutKey.push(row);
          return;
        }
        rowsByKey[row.poLineKey] = row;
      } else {
        rowsWithoutKey.push(row);
      }
    });

    return { rowsByKey, rowsWithoutKey };
  }

  function syncPersistedItems(parentId, selectedPoIdsInput) {
    const selectedPoIds = normalizeIds(selectedPoIdsInput);
    const existing = loadExistingItemsByKey(parentId);
    const createdKeys = new Set();
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    const poLines = fetchPurchaseOrderItemLines(selectedPoIds);
    poLines.forEach((line) => {
      if (line.poLineKey && createdKeys.has(line.poLineKey)) return;
      const existingRow = line.poLineKey ? existing.rowsByKey[line.poLineKey] : null;
      if (existingRow) {
        if (updateLcmItem(existingRow, line)) updatedCount += 1;
      } else {
        createLcmItem(parentId, line);
        createdCount += 1;
      }
      if (line.poLineKey) createdKeys.add(line.poLineKey);
    });

    Object.keys(existing.rowsByKey).forEach((poLineKey) => {
      if (createdKeys.has(poLineKey)) return;
      record.delete({ type: RECORDS.lcmItems, id: existing.rowsByKey[poLineKey].id });
      deletedCount += 1;
    });

    existing.rowsWithoutKey.forEach((row) => {
      record.delete({ type: RECORDS.lcmItems, id: row.id });
      deletedCount += 1;
    });

    return {
      selectedPoCount: selectedPoIds.length,
      sourceLineCount: poLines.length,
      createdCount,
      updatedCount,
      deletedCount,
    };
  }

  function hasCreatedAccountingRows(parentId) {
    const f = FIELDS.lcmLandedCosts;
    let found = false;
    search
      .create({
        type: RECORDS.lcmLandedCosts,
        filters: [
          [f.parent, 'anyof', parentId],
          'AND',
          [
            [f.createdTransactionId, 'isnotempty', ''],
            'OR',
            [f.processingStatus, 'is', 'Created'],
          ],
        ],
        columns: ['internalid'],
      })
      .run()
      .each(() => {
        found = true;
        return false;
      });
    return found;
  }

  return {
    normalizeIds,
    fetchPurchaseOrderItemLines,
    hasCreatedAccountingRows,
    syncPersistedItems,
  };
});
