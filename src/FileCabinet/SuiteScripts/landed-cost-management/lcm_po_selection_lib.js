/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', './lcm_po_selection_config'], (record, search, config) => {
  const { RECORDS, FIELDS } = config;
  const RECEIVABLE_ITEM_TYPES = {
    assembly: true,
    assemblyitem: true,
    inventoryitem: true,
    inventorypart: true,
    invtpart: true,
    lotnumberedassemblyitem: true,
    lotnumberedinventoryitem: true,
    lotnumberedinvtpart: true,
    serializedassemblyitem: true,
    serializedinventoryitem: true,
    serializedinvtpart: true,
  };

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

  function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function getBillStatus(expectedQuantityReceipt, quantityReceipt) {
    return toNumber(expectedQuantityReceipt) === toNumber(quantityReceipt) ? 'full' : 'partial';
  }

  function getRemainingQuantity(expectedQuantityReceipt, quantityReceipt) {
    const expected = toNumber(expectedQuantityReceipt) || 0;
    const receiving = toNumber(quantityReceipt) || 0;
    return Math.max(0, expected - receiving);
  }

  function getLineValue(unitCost, quantityReceipt) {
    return roundCurrency((toNumber(unitCost) || 0) * (toNumber(quantityReceipt) || 0));
  }

  function isReceivableItemType(itemTypeValue, itemTypeText) {
    const normalizedValue = normalizeItemType(itemTypeValue);
    const normalizedText = normalizeItemType(itemTypeText);
    if (!normalizedValue && !normalizedText) return true;
    return Boolean(RECEIVABLE_ITEM_TYPES[normalizedValue] || RECEIVABLE_ITEM_TYPES[normalizedText]);
  }

  function normalizeItemType(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  }

  function normalizeVendorId(vendorId) {
    return String(vendorId || '').trim();
  }

  function appendVendorFilter(filters, vendorId) {
    const normalizedVendorId = normalizeVendorId(vendorId);
    if (!normalizedVendorId) return filters;
    return filters.concat(['AND', ['entity', 'anyof', normalizedVendorId]]);
  }

  function fetchPurchaseOrderHeaders(poIds, vendorIdInput) {
    const headersById = {};
    const filters = appendVendorFilter(
      [
        ['internalid', 'anyof', poIds],
        'AND',
        ['mainline', 'is', 'T'],
      ],
      vendorIdInput
    );

    search
      .create({
        type: search.Type.PURCHASE_ORDER,
        filters,
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

  function validatePurchaseOrderVendor(poIdsInput, vendorIdInput) {
    const poIds = normalizeIds(poIdsInput);
    const vendorId = normalizeVendorId(vendorIdInput);
    if (!poIds.length || !vendorId) return;

    const mismatches = [];
    search
      .create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['internalid', 'anyof', poIds],
          'AND',
          ['mainline', 'is', 'T'],
          'AND',
          ['entity', 'noneof', vendorId],
        ],
        columns: ['internalid', 'tranid', 'entity'],
      })
      .run()
      .each((result) => {
        mismatches.push(
          `${result.getValue({ name: 'tranid' }) || result.getValue({ name: 'internalid' })} / ${
            result.getText({ name: 'entity' }) || result.getValue({ name: 'entity' }) || 'no vendor'
          }`
        );
        return mismatches.length < 10;
      });

    if (mismatches.length) {
      throw new Error(`Selected Purchase Orders must match the Purchase Order Vendor. Mismatched PO(s): ${mismatches.join(', ')}`);
    }
  }

  function fetchPurchaseOrderItemLines(poIdsInput, vendorIdInput) {
    const poIds = normalizeIds(poIdsInput);
    if (!poIds.length) return [];

    const rows = [];
    const vendorId = normalizeVendorId(vendorIdInput);
    validatePurchaseOrderVendor(poIds, vendorId);
    const headersById = fetchPurchaseOrderHeaders(poIds, vendorId);
    const filters = appendVendorFilter(
      [
        ['internalid', 'anyof', poIds],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['taxline', 'is', 'F'],
        'AND',
        ['shipping', 'is', 'F'],
        'AND',
        ['closed', 'is', 'F'],
        'AND',
        ['item', 'noneof', '@NONE@'],
      ],
      vendorId
    );
    const itemTypeColumn = search.createColumn({ name: 'type', join: 'item' });
    const poSearch = search.create({
      type: search.Type.PURCHASE_ORDER,
      filters,
      columns: [
        search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
        'tranid',
        'entity',
        'item',
        'memo',
        'quantity',
        'quantityshiprecv',
        'rate',
        'unit',
        'exchangerate',
        'lineuniquekey',
        itemTypeColumn,
      ],
    });

    let lineIndex = 0;
    poSearch.run().each((result) => {
      const poId = String(result.getValue({ name: 'internalid' }) || '');
      const header = headersById[poId] || {};
      const itemId = String(result.getValue({ name: 'item' }) || '');
      const quantity = toNumber(result.getValue({ name: 'quantity' }));
      const alreadyReceived = toNumber(result.getValue({ name: 'quantityshiprecv' }));
      const lineUniqueKey = String(result.getValue({ name: 'lineuniquekey' }) || '');
      const expectedQuantityReceipt =
        quantity === null ? null : quantity - (alreadyReceived === null ? 0 : alreadyReceived);
      const itemTypeValue = String(result.getValue(itemTypeColumn) || '');
      const itemTypeText = String(result.getText(itemTypeColumn) || '');
      const poRate = toNumber(result.getValue({ name: 'rate' }));

      if ((expectedQuantityReceipt || 0) <= 0) {
        lineIndex += 1;
        return true;
      }

      if (!isReceivableItemType(itemTypeValue, itemTypeText)) {
        lineIndex += 1;
        return true;
      }

      rows.push({
        poId,
        poNumber: header.poNumber || String(result.getValue({ name: 'tranid' }) || ''),
        vendorId: header.vendorId || String(result.getValue({ name: 'entity' }) || ''),
        vendorText: header.vendorText || String(result.getText({ name: 'entity' }) || ''),
        itemId,
        itemText: String(result.getText({ name: 'item' }) || ''),
        description: String(result.getValue({ name: 'memo' }) || ''),
        quantity,
        alreadyReceived,
        expectedQuantityReceipt,
        quantityReceipt: expectedQuantityReceipt,
        quantityRemaining: 0,
        billStatus: 'full',
        poRate,
        poValue: getLineValue(poRate, expectedQuantityReceipt),
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
          FIELDS.lcmItems.billStatus,
          FIELDS.lcmItems.unitType,
          FIELDS.lcmItems.poRate,
          FIELDS.lcmItems.poValue,
          FIELDS.lcmItems.exchangeRate,
          FIELDS.lcmItems.trackItem,
          FIELDS.lcmItems.unitLandedCost,
          FIELDS.lcmItems.totalUnitCost,
          FIELDS.lcmItems.totalValue,
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
          expectedQuantityReceipt: toNumber(result.getValue({ name: FIELDS.lcmItems.expectedQuantityReceipt })),
          quantityReceipt: toNumber(result.getValue({ name: FIELDS.lcmItems.quantityReceipt })),
          quantityRemaining: toNumber(result.getValue({ name: FIELDS.lcmItems.quantityRemaining })),
          billStatus: String(result.getValue({ name: FIELDS.lcmItems.billStatus }) || ''),
          unitType: String(result.getValue({ name: FIELDS.lcmItems.unitType }) || ''),
          poRate: toNumber(result.getValue({ name: FIELDS.lcmItems.poRate })),
          poValue: toNumber(result.getValue({ name: FIELDS.lcmItems.poValue })),
          exchangeRate: String(result.getValue({ name: FIELDS.lcmItems.exchangeRate }) || ''),
          trackItem: result.getValue({ name: FIELDS.lcmItems.trackItem }) === true || result.getValue({ name: FIELDS.lcmItems.trackItem }) === 'T',
          unitLandedCost: toNumber(result.getValue({ name: FIELDS.lcmItems.unitLandedCost })),
          totalUnitCost: toNumber(result.getValue({ name: FIELDS.lcmItems.totalUnitCost })),
          totalValue: toNumber(result.getValue({ name: FIELDS.lcmItems.totalValue })),
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
    setIfPresent(rec, FIELDS.lcmItems.quantityReceipt, poLine.quantityReceipt);
    setIfPresent(rec, FIELDS.lcmItems.expectedQuantityReceipt, poLine.expectedQuantityReceipt);
    setIfPresent(rec, FIELDS.lcmItems.quantityRemaining, poLine.quantityRemaining);
    setIfPresent(rec, FIELDS.lcmItems.billStatus, poLine.billStatus);
    setIfPresent(rec, FIELDS.lcmItems.unitType, poLine.unitType);
    setIfPresent(rec, FIELDS.lcmItems.poRate, poLine.poRate);
    setIfPresent(rec, FIELDS.lcmItems.poValue, poLine.poValue);
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
    setChangedValue(values, FIELDS.lcmItems.expectedQuantityReceipt, existingRow.expectedQuantityReceipt, poLine.expectedQuantityReceipt);
    const quantityReceipt =
      existingRow.quantityReceipt === null || existingRow.quantityReceipt === undefined
        ? poLine.quantityReceipt
        : existingRow.quantityReceipt;
    setChangedValue(
      values,
      FIELDS.lcmItems.quantityRemaining,
      existingRow.quantityRemaining,
      getRemainingQuantity(poLine.expectedQuantityReceipt, quantityReceipt)
    );
    setChangedValue(
      values,
      FIELDS.lcmItems.billStatus,
      existingRow.billStatus,
      getBillStatus(poLine.expectedQuantityReceipt, quantityReceipt)
    );
    setChangedValue(values, FIELDS.lcmItems.unitType, existingRow.unitType, poLine.unitType);
    setChangedValue(values, FIELDS.lcmItems.poRate, existingRow.poRate, poLine.poRate);
    setChangedValue(values, FIELDS.lcmItems.poValue, existingRow.poValue, getLineValue(poLine.poRate, quantityReceipt));
    setChangedValue(
      values,
      FIELDS.lcmItems.totalValue,
      existingRow.totalValue,
      getLineValue(existingRow.totalUnitCost, quantityReceipt)
    );
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

  function getVendorDefaults(vendorId) {
    const subsidiary = lookupVendorField(vendorId, 'subsidiary');
    return {
      subsidiary: subsidiary.value,
      subsidiaryText: subsidiary.text,
    };
  }

  function lookupVendorField(vendorId, fieldId) {
    if (!vendorId) return { value: '', text: '' };
    try {
      const values = search.lookupFields({
        type: search.Type.VENDOR,
        id: vendorId,
        columns: [fieldId],
      });
      return {
        value: extractLookupValue(values[fieldId]),
        text: extractLookupText(values[fieldId]),
      };
    } catch (error) {
      return { value: '', text: '' };
    }
  }

  function extractLookupValue(value) {
    if (!value) return '';
    if (Array.isArray(value)) return value.length ? String(value[0].value || value[0]) : '';
    if (typeof value === 'object') return String(value.value || '');
    return String(value);
  }

  function extractLookupText(value) {
    if (!value) return '';
    if (Array.isArray(value)) return value.length ? String(value[0].text || value[0].value || '') : '';
    if (typeof value === 'object') return String(value.text || value.value || '');
    return String(value);
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

  function syncPersistedItems(parentId, selectedPoIdsInput, vendorIdInput) {
    const selectedPoIds = normalizeIds(selectedPoIdsInput);
    const existing = loadExistingItemsByKey(parentId);
    const createdKeys = new Set();
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    const poLines = fetchPurchaseOrderItemLines(selectedPoIds, vendorIdInput);
    poLines.forEach((line) => {
      if (line.poLineKey && createdKeys.has(line.poLineKey)) return;
      const existingRow =
        (line.poLineKey ? existing.rowsByKey[line.poLineKey] : null) ||
        takeExistingRowWithoutKey(existing.rowsWithoutKey, line);
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

  function takeExistingRowWithoutKey(rowsWithoutKey, poLine) {
    for (let index = 0; index < rowsWithoutKey.length; index += 1) {
      const row = rowsWithoutKey[index];
      if (normalizeComparable(row.poId) !== normalizeComparable(poLine.poId)) continue;
      if (normalizeComparable(row.itemId) !== normalizeComparable(poLine.itemId)) continue;
      rowsWithoutKey.splice(index, 1);
      return row;
    }
    return null;
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
    getVendorDefaults,
    hasCreatedAccountingRows,
    syncPersistedItems,
    validatePurchaseOrderVendor,
  };
});
