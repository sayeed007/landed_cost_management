/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(
  ['N/format', 'N/log', 'N/record', 'N/search', './lcm_po_selection_config', './lcm_shipment_status_lib'],
  (format, log, record, search, config, shipmentStatus) => {
  const { RECORDS, FIELDS, TRANSACTION_FIELDS, ACCOUNT_CONSTANTS, DEFAULTS } = config;
  const STATUS = {
    pending: 'Pending',
    created: 'Created',
  };
  const MODES = {
    bill: 'bill',
    journal: 'journal',
  };
  const vendorDefaultsCache = {};
  const costItemMapDefaultsCache = {};
  const journalAccountCandidatesCache = {};

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function normalizeValue(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function normalizeIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function normalizeChoice(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  }

  function getModeText(mode) {
    return mode === MODES.journal ? 'Journal' : 'Bill';
  }

  function buildPreview(parentId, modeInput) {
    const mode = normalizeMode(modeInput);
    const preview = {
      ok: false,
      mode,
      modeText: getModeText(mode),
      parentId: String(parentId || ''),
      allocationTargetCount: 0,
      eligibleRows: [],
      skippedRows: [],
      unallocatedCreatedRows: [],
      errors: [],
      groups: [],
    };

    if (!preview.parentId) {
      preview.errors.push('Missing Landed Cost Management record ID.');
      return preview;
    }

    assertParentAccessible(preview.parentId);
    const rows = fetchLandedCostRows(parentId).filter((row) => row.targetMode === mode);
    const trackedItems = mode === MODES.bill ? fetchTrackedItems(parentId) : [];
    preview.allocationTargetCount = trackedItems.length;

    if (!rows.length) {
      preview.errors.push(`No Landed Cost rows are marked for ${preview.modeText}.`);
      return preview;
    }

    const createdRows = [];
    rows.forEach((row) => {
      if (row.isCreated) {
        createdRows.push(row);
        if (mode === MODES.bill && !row.costAllocatedInGrn) {
          preview.unallocatedCreatedRows.push(row);
        }
        preview.skippedRows.push({
          id: row.id,
          reason: `Already created: ${row.createdTransactionType || 'Transaction'} ${
            row.transactionNumber || row.createdTransactionId || ''
          }${mode === MODES.bill && !row.costAllocatedInGrn ? '; pending landed-cost allocation' : ''}`,
        });
        return;
      }

      const rowErrors = validateRow(row, mode);
      if (rowErrors.length) {
        preview.errors.push(`Line ${row.id}: ${rowErrors.join('; ')}`);
        return;
      }

      preview.eligibleRows.push(row);
    });

    if (mode === MODES.bill && (preview.eligibleRows.length || preview.unallocatedCreatedRows.length) && !trackedItems.length) {
      preview.errors.push('At least one LCM Item row must have Track Item checked before creating accounting.');
    }

    preview.groups = groupRows(preview.eligibleRows, mode, createdRows);
    preview.ok = preview.errors.length === 0 && (preview.eligibleRows.length > 0 || preview.unallocatedCreatedRows.length > 0);
    return preview;
  }

  function createTransactions(parentId, modeInput) {
    const preview = buildPreview(parentId, modeInput);
    if (!preview.ok) {
      const error = new Error(preview.errors.join('\n') || 'No eligible rows to process.');
      error.preview = preview;
      throw error;
    }

    const created = [];
    const createdRows = [];
    let allocatedRowCount = 0;
    preview.groups.forEach((group) => {
      const transaction =
        preview.mode === MODES.bill ? createVendorBill(group) : createJournalEntry(group);
      markCostRowsCreated(group.rows, transaction);
      createdRows.push(...group.rows);
      created.push(transaction);
    });
    if (preview.mode === MODES.bill) {
      const rowsForAllocation = getCreatedBillRows(parentId);
      allocateCreatedCosts(parentId, rowsForAllocation, { reset: true });
      markCostRowsAllocated(rowsForAllocation);
      shipmentStatus.recalculate(parentId);
      allocatedRowCount = rowsForAllocation.length;
    }

    return {
      mode: preview.mode,
      modeText: preview.modeText,
      created,
      processedRowCount: preview.eligibleRows.length,
      allocatedRowCount,
      skippedRows: preview.skippedRows,
      allocationTargetCount: preview.allocationTargetCount,
    };
  }

  function buildAllocationPreview(parentId) {
    const preview = {
      ok: false,
      mode: 'allocation',
      modeText: 'Landed Cost Recalculation',
      parentId: String(parentId || ''),
      allocationTargetCount: 0,
      createdBillRows: [],
      unallocatedCreatedRows: [],
      errors: [],
    };

    if (!preview.parentId) {
      preview.errors.push('Missing Landed Cost Management record ID.');
      return preview;
    }

    assertParentAccessible(preview.parentId);
    preview.createdBillRows = getCreatedBillRows(parentId);
    preview.unallocatedCreatedRows = preview.createdBillRows.filter((row) => !row.costAllocatedInGrn);
    preview.allocationTargetCount = fetchTrackedItems(parentId).length;

    if (!preview.createdBillRows.length) {
      preview.errors.push('No created Vendor Bill landed-cost rows are available for allocation.');
    }
    if (!preview.allocationTargetCount) {
      preview.errors.push('At least one LCM Item row must have Track Item checked before recalculating landed cost.');
    }

    preview.ok = preview.errors.length === 0;
    return preview;
  }

  function recalculateAllocatedCosts(parentId) {
    const preview = buildAllocationPreview(parentId);
    if (!preview.ok) {
      const error = new Error(preview.errors.join('\n') || 'No created Bill rows to allocate.');
      error.preview = preview;
      throw error;
    }

    allocateCreatedCosts(parentId, preview.createdBillRows, { reset: true });
    markCostRowsAllocated(preview.createdBillRows);
    shipmentStatus.recalculate(parentId);

    return {
      mode: preview.mode,
      modeText: preview.modeText,
      created: [],
      processedRowCount: 0,
      allocatedRowCount: preview.createdBillRows.length,
      pendingAllocatedRowCount: preview.unallocatedCreatedRows.length,
      skippedRows: [],
      allocationTargetCount: preview.allocationTargetCount,
    };
  }

  function assertParentAccessible(parentId) {
    if (!parentId) throw new Error('Missing Landed Cost Management record ID.');
    record.load({
      type: RECORDS.landedCostManagement,
      id: parentId,
      isDynamic: false,
    });
  }

  function normalizeMode(modeInput) {
    const mode = normalizeChoice(modeInput);
    return mode === MODES.journal || mode === 'journalentry' ? MODES.journal : MODES.bill;
  }

  function fetchLandedCostRows(parentId) {
    if (!parentId) return [];
    const f = FIELDS.lcmLandedCosts;
    const parentDefaults = getParentAccountingDefaults(parentId);
    const columns = [
      'internalid',
      f.parent,
      f.targetType,
      f.billLineType,
      f.billType,
      f.vendor,
      f.subsidiary,
      f.costItemMap,
      f.costCategory,
      f.amount,
      f.currency,
      f.exchangeRate,
      f.effectiveDate,
      f.allocationMethod,
      f.billItem,
      f.department,
      f.class,
      f.location,
      f.memo,
      f.transactionNumber,
      f.processingStatus,
      f.createdTransactionId,
      f.createdTransactionType,
      f.costAllocatedInGrn,
    ];
    const rows = [];

    search
      .create({
        type: RECORDS.lcmLandedCosts,
        filters: [[f.parent, 'anyof', parentId]],
        columns,
      })
      .run()
      .each((result) => {
        const targetText = getText(result, f.targetType);
        const targetChoice = normalizeChoice(targetText);
        const status = getValue(result, f.processingStatus);
        const createdTransactionId = getValue(result, f.createdTransactionId);
        rows.push({
          id: getValue(result, 'internalid'),
          targetType: getValue(result, f.targetType),
          targetTypeText: targetText,
          targetMode:
            targetChoice.indexOf('journal') >= 0
              ? MODES.journal
              : targetChoice.indexOf('bill') >= 0
              ? MODES.bill
              : '',
          billLineType: getValue(result, f.billLineType),
          billLineTypeText: getText(result, f.billLineType),
          billType: getValue(result, f.billType),
          billTypeText: getText(result, f.billType),
          vendor: getValue(result, f.vendor),
          vendorText: getText(result, f.vendor),
          subsidiary: getValue(result, f.subsidiary),
          subsidiaryText: getText(result, f.subsidiary),
          costItemMap: getValue(result, f.costItemMap),
          costItemMapText: getText(result, f.costItemMap),
          costCategory: getValue(result, f.costCategory),
          costCategoryText: getText(result, f.costCategory),
          amount: toNumber(getValue(result, f.amount)),
          currency: getValue(result, f.currency),
          currencyText: getText(result, f.currency),
          exchangeRate: toNumber(getValue(result, f.exchangeRate)) || 1,
          effectiveDate: getValue(result, f.effectiveDate),
          allocationMethod: getValue(result, f.allocationMethod),
          allocationMethodText: getText(result, f.allocationMethod),
          billItem: getValue(result, f.billItem),
          billItemText: getText(result, f.billItem),
          department: getValue(result, f.department),
          class: getValue(result, f.class),
          location: getValue(result, f.location),
          memo: getValue(result, f.memo),
          transactionNumber: getValue(result, f.transactionNumber),
          processingStatus: status,
          createdTransactionId,
          createdTransactionType: getValue(result, f.createdTransactionType),
          costAllocatedInGrn: isChecked(getValue(result, f.costAllocatedInGrn)),
          isCreated: normalizeChoice(status) === normalizeChoice(STATUS.created) || Boolean(createdTransactionId),
        });
        return true;
      });

    return rows.map((row) => enrichRow(row, parentDefaults));
  }

  function getCreatedBillRows(parentId) {
    return fetchLandedCostRows(parentId).filter((row) => {
      const transactionType = normalizeChoice(row.createdTransactionType);
      return row.isCreated && (row.targetMode === MODES.bill || transactionType.indexOf('vendorbill') >= 0 || transactionType === 'bill');
    });
  }

  function getParentAccountingDefaults(parentId) {
    try {
      const rec = record.load({
        type: RECORDS.landedCostManagement,
        id: parentId,
        isDynamic: false,
      });
      return {
        subsidiary: getRecordValue(rec, FIELDS.landedCostManagement.subsidiary),
        subsidiaryText: getRecordText(rec, FIELDS.landedCostManagement.subsidiary),
      };
    } catch (error) {
      return {};
    }
  }

  function enrichRow(row, parentDefaults) {
    if (!row.subsidiary && parentDefaults.subsidiary) {
      row.subsidiary = parentDefaults.subsidiary;
      row.subsidiaryText = parentDefaults.subsidiaryText || row.subsidiaryText;
    }
    row.billLineTypeText = row.billLineTypeText || DEFAULTS.billLineTypeText;
    row.billTypeText = DEFAULTS.billTypeText;
    applyCostItemMapDefaults(row);
    return enrichRowFromVendor(row);
  }

  function enrichRowFromVendor(row) {
    if (!row.vendor) return row;

    const defaults = getVendorDefaults(row.vendor);
    if (!row.subsidiary && defaults.subsidiary) {
      row.subsidiary = defaults.subsidiary;
      row.subsidiaryText = defaults.subsidiaryText || row.subsidiaryText;
    }
    if (!row.currency && defaults.currency) {
      row.currency = defaults.currency;
      row.currencyText = defaults.currencyText || row.currencyText;
    }

    return row;
  }

  function applyCostItemMapDefaults(row) {
    if (!row.costItemMap) return row;
    const defaults = getCostItemMapDefaults(row.costItemMap);
    if (!defaults.costCategory && !defaults.costCategoryText) return row;

    if (!row.costCategory) {
      row.costCategory = defaults.costCategory || row.costCategory;
      row.costCategoryText = defaults.costCategoryText || row.costCategoryText;
    }
    if (!row.billItem) {
      row.billItem = defaults.billItem || row.billItem;
      row.billItemText = defaults.billItemText || row.billItemText;
    }
    return row;
  }

  function getCostItemMapDefaults(costItemMapId) {
    const mapId = normalizeValue(costItemMapId);
    const cacheKey = `map|${mapId}`;
    if (costItemMapDefaultsCache[cacheKey]) return costItemMapDefaultsCache[cacheKey];

    const map = lookupCostItemMapById(mapId);
    const activeItem = findActiveItemByInternalId(map.billItem, map.billItemText);
    const itemMissing = !activeItem.id;
    const defaults = {
      costItemMap: map.id,
      costItemMapText: map.text,
      costCategory: map.costCategory,
      costCategoryText: map.costCategoryText,
      billItem: activeItem.id,
      billItemText: activeItem.text,
      attemptedItemName: map.billItemText,
      matched: Boolean(map.id && map.costCategory && activeItem.id),
      reason: itemMissing ? activeItem.reason || map.reason : map.reason,
      source: map.id ? 'mapping record' : 'none',
      mappingRecordId: map.id,
    };

    log[defaults.matched ? 'audit' : 'error']({
      title: `LCM Cost Category Item Map ${defaults.matched ? 'resolved' : 'did NOT resolve'} defaults`,
      details:
        `Mapping record: ${mapId || '(none)'}. ` +
        `Category: ${defaults.costCategory || '(none)'} ("${defaults.costCategoryText || ''}"). ` +
        `Item: ${defaults.billItem || '(none)'} ("${defaults.billItemText || ''}"). ` +
        `Reason: ${defaults.reason || '(none)'}`,
    });

    costItemMapDefaultsCache[cacheKey] = defaults;
    return defaults;
  }

  function lookupCostItemMapById(costItemMapId) {
    const mapId = normalizeValue(costItemMapId);
    if (!mapId) return { id: '', text: '', reason: 'No LCM Cost Category Item Map was selected.' };

    const f = FIELDS.lcmCostItemMap;
    try {
      const results = search
        .create({
          type: RECORDS.lcmCostItemMap,
          filters: [['isinactive', 'is', 'F'], 'AND', ['internalid', 'anyof', mapId]],
          columns: ['internalid', 'name', f.costCategory, f.costItem],
        })
        .run()
        .getRange({ start: 0, end: 1 });

      if (!results || !results.length) {
        return {
          id: '',
          text: '',
          reason: `LCM Cost Category Item Map record ${mapId} is inactive or cannot be found.`,
        };
      }

      const result = results[0];
      const categoryId = normalizeValue(result.getValue({ name: f.costCategory }));
      const categoryText = normalizeValue(result.getText({ name: f.costCategory }));
      const itemId = normalizeValue(result.getValue({ name: f.costItem }));
      const itemText = normalizeValue(result.getText({ name: f.costItem }));
      return {
        id: normalizeValue(result.getValue({ name: 'internalid' })),
        text: normalizeValue(result.getValue({ name: 'name' })) || categoryText,
        costCategory: categoryId,
        costCategoryText: categoryText,
        billItem: itemId,
        billItemText: itemText,
        reason: `Matched LCM Cost Category Item Map record ${mapId}.`,
      };
    } catch (error) {
      return {
        id: '',
        text: '',
        reason: `LCM Cost Category Item Map record ${mapId} lookup failed: ${error.message || error}`,
      };
    }
  }


  function findActiveItemByInternalId(itemId, itemText) {
    const id = normalizeValue(itemId);
    if (!id) return { id: '', text: '', reason: 'Mapped LC Cost Item was blank.' };

    try {
      const results = search
        .create({
          type: 'item',
          filters: [['isinactive', 'is', 'F'], 'AND', ['internalid', 'anyof', id]],
          columns: ['internalid', 'itemid', 'displayname'],
        })
        .run()
        .getRange({ start: 0, end: 1 });

      if (results && results.length) {
        const result = results[0];
        return {
          id,
          text:
            normalizeValue(result.getValue({ name: 'itemid' })) ||
            normalizeValue(result.getValue({ name: 'displayname' })) ||
            normalizeValue(itemText) ||
            id,
          reason: `Matched active item through LCM Cost Category Item Map.`,
        };
      }
    } catch (error) {
      return { id: '', text: normalizeValue(itemText), reason: `Mapped item ${id} lookup failed: ${error.message || error}` };
    }

    return { id: '', text: normalizeValue(itemText), reason: `Mapped item ${id} is not active or cannot be found.` };
  }

  function listCostCategoryItemMatches() {
    const f = FIELDS.lcmCostItemMap;
    const rows = [];

    search
      .create({
        type: RECORDS.lcmCostItemMap,
        filters: [['isinactive', 'is', 'F']],
        columns: ['internalid', 'name', f.costCategory, f.costItem],
      })
      .run()
      .each((result) => {
        const mapId = normalizeValue(result.getValue({ name: 'internalid' }));
        const defaults = getCostItemMapDefaults(mapId);
        if (!defaults.matched) return true;
        rows.push({
          costItemMapId: mapId,
          costItemMapText: normalizeValue(result.getValue({ name: 'name' })) || defaults.costCategoryText,
          costCategoryId: defaults.costCategory,
          costCategoryText: defaults.costCategoryText,
          itemId: defaults.billItem,
          itemText: defaults.billItemText,
          matched: true,
          source: defaults.source,
          mappingRecordId: defaults.mappingRecordId,
          reason: defaults.reason || '',
        });
        return true;
      });

    return rows;
  }

  function listCostCategories() {
    const attempts = [
      { type: 'costcategory', columns: ['internalid', 'name'] },
      { type: 'landedcostcategory', columns: ['internalid', 'name'] },
    ];
    const categoriesById = {};

    attempts.forEach((attempt) => {
      try {
        search
          .create({
            type: attempt.type,
            filters: [],
            columns: attempt.columns,
          })
          .run()
          .each((result) => {
            const id = normalizeValue(result.getValue({ name: 'internalid' }));
            const text = normalizeValue(result.getValue({ name: 'name' })) || normalizeValue(result.getText({ name: 'name' }));
            if (id && text && !categoriesById[id]) {
              categoriesById[id] = { id, text };
            }
            return true;
          });
      } catch (error) {
        log.audit({
          title: 'LCM cost category list attempt failed',
          details: `${attempt.type}: ${error.message || error}`,
        });
      }
    });

    return Object.keys(categoriesById)
      .map((id) => categoriesById[id])
      .sort((a, b) => a.text.localeCompare(b.text));
  }

  function getVendorDefaults(vendorId) {
    if (!vendorId) return {};
    if (vendorDefaultsCache[vendorId]) return vendorDefaultsCache[vendorId];

    const subsidiary = lookupVendorField(vendorId, 'subsidiary');
    const currency = lookupFirstVendorField(vendorId, ['currency', 'defaultcurrency']);

    vendorDefaultsCache[vendorId] = {
      subsidiary: subsidiary.value,
      subsidiaryText: subsidiary.text,
      currency: currency.value,
      currencyText: currency.text,
    };
    return vendorDefaultsCache[vendorId];
  }

  function getVendorBillDefaults(vendorId) {
    const defaults = getVendorDefaults(vendorId);
    if (!vendorId) return defaults;

    try {
      const bill = record.create({ type: record.Type.VENDOR_BILL, isDynamic: true });
      setIfPresent(bill, 'entity', vendorId);

      const billDefaults = {
        subsidiary: getRecordValue(bill, 'subsidiary') || defaults.subsidiary,
        subsidiaryText: getRecordText(bill, 'subsidiary') || defaults.subsidiaryText,
        currency: getRecordValue(bill, 'currency') || defaults.currency,
        currencyText: getRecordText(bill, 'currency') || defaults.currencyText,
        exchangeRate: getRecordValue(bill, 'exchangerate'),
        billType: getRecordValue(bill, TRANSACTION_FIELDS.vendorBill.billType),
        billTypeText: getRecordText(bill, TRANSACTION_FIELDS.vendorBill.billType),
      };
      return billDefaults;
    } catch (error) {
      return defaults;
    }
  }

  function getVendorCurrencyDefaults(vendorId, currencyId, subsidiaryId) {
    const defaults = getVendorDefaults(vendorId);
    if (!vendorId || !currencyId) return { exchangeRate: '' };

    try {
      const bill = record.create({ type: record.Type.VENDOR_BILL, isDynamic: false });
      setIfPresent(bill, 'entity', vendorId);
      setIfPresent(bill, 'subsidiary', subsidiaryId || defaults.subsidiary);
      setIfPresent(bill, 'currency', currencyId);
      return {
        currency: getRecordValue(bill, 'currency') || String(currencyId),
        currencyText: getRecordText(bill, 'currency'),
        exchangeRate: getRecordValue(bill, 'exchangerate') || '1',
      };
    } catch (error) {
      log.audit({
        title: 'LCM vendor currency defaults unavailable',
        details: `${vendorId}/${currencyId}: ${error.message || error}`,
      });
      return {
        currency: String(currencyId),
        currencyText: '',
        exchangeRate: '',
      };
    }
  }

  function getSelectedPurchaseOrderDefaults(poIdsInput) {
    const poIds = normalizeIds(poIdsInput);
    const headerLocations = lookupPurchaseOrderLocations(poIds, true);
    const lineLocations = lookupPurchaseOrderLocations(poIds, false);

    for (let index = 0; index < poIds.length; index += 1) {
      const poId = poIds[index];
      if (headerLocations[poId] && headerLocations[poId].location) return headerLocations[poId];
      if (lineLocations[poId] && lineLocations[poId].location) return lineLocations[poId];
    }

    return { location: '', locationText: '' };
  }

  function lookupPurchaseOrderLocations(poIds, mainline) {
    const locationsByPoId = {};
    if (!poIds.length) return locationsByPoId;

    try {
      search
        .create({
          type: search.Type.PURCHASE_ORDER,
          filters: [
            ['internalid', 'anyof', poIds],
            'AND',
            ['mainline', 'is', mainline ? 'T' : 'F'],
          ],
          columns: ['internalid', 'location'],
        })
        .run()
        .each((result) => {
          const poId = normalizeValue(result.getValue({ name: 'internalid' }));
          const location = normalizeValue(result.getValue({ name: 'location' }));
          if (!poId || (locationsByPoId[poId] && locationsByPoId[poId].location)) return true;
          locationsByPoId[poId] = {
            location,
            locationText: normalizeValue(result.getText({ name: 'location' })),
          };
          return true;
        });
    } catch (error) {
      log.audit({
        title: `LCM selected PO ${mainline ? 'header' : 'line'} location lookup failed`,
        details: error.message || error,
      });
    }

    return locationsByPoId;
  }

  function isChecked(value) {
    return value === true || value === 'T' || value === 'true';
  }

  function lookupFirstVendorField(vendorId, fieldIds) {
    for (let index = 0; index < fieldIds.length; index += 1) {
      const result = lookupVendorField(vendorId, fieldIds[index]);
      if (result.value || result.text) return result;
    }
    return { value: '', text: '' };
  }

  function lookupVendorField(vendorId, fieldId) {
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

  function getAllocationMethodDefault(costCategoryId) {
    const nativeMethod = lookupCostCategoryAllocationMethod(costCategoryId);
    const allocationMethodText = mapAllocationMethodText(nativeMethod) || 'Value';
    return { allocationMethodText };
  }

  function lookupCostCategoryAllocationMethod(costCategoryId) {
    if (!costCategoryId) return '';
    const attempts = [
      { type: 'costcategory', columns: ['costallocationmethod', 'allocationmethod', 'defaultallocationmethod'] },
      { type: 'landedcostcategory', columns: ['costallocationmethod', 'allocationmethod', 'defaultallocationmethod'] },
    ];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      for (let columnIndex = 0; columnIndex < attempt.columns.length; columnIndex += 1) {
        try {
          const fieldId = attempt.columns[columnIndex];
          const values = search.lookupFields({
            type: attempt.type,
            id: costCategoryId,
            columns: [fieldId],
          });
          const value = values[fieldId];
          const text = extractLookupText(value) || extractLookupValue(value);
          if (text) return text;
        } catch (error) {
          // NetSuite exposes landed cost category fields differently by account/version.
        }
      }
    }
    return '';
  }

  function mapAllocationMethodText(value) {
    const method = normalizeChoice(value);
    if (!method) return '';
    if (method.indexOf('quant') >= 0 || method.indexOf('qty') >= 0) return 'Quantity';
    if (method.indexOf('amount') >= 0 || method.indexOf('value') >= 0 || method.indexOf('rate') >= 0) return 'Value';
    if (method.indexOf('weight') >= 0) return 'Weight';
    if (method.indexOf('equal') >= 0) return 'Equal';
    return '';
  }

  function fetchTrackedItems(parentId) {
    if (!parentId) return [];
    const f = FIELDS.lcmItems;
    const rows = [];

    search
      .create({
        type: RECORDS.lcmItems,
        filters: [
          [f.parent, 'anyof', parentId],
          'AND',
          [f.trackItem, 'is', 'T'],
        ],
        columns: [
          'internalid',
          f.quantityReceipt,
          f.poRate,
          f.exchangeRate,
          f.unitLandedCost,
          f.totalUnitCost,
        ],
      })
      .run()
      .each((result) => {
        const quantity = toNumber(getValue(result, f.quantityReceipt));
        if (quantity !== null && quantity <= 0) return true;
        rows.push({
          id: getValue(result, 'internalid'),
          quantity: quantity === null ? 1 : quantity,
          poRate: toNumber(getValue(result, f.poRate)) || 0,
          exchangeRate: toNumber(getValue(result, f.exchangeRate)) || 1,
          unitLandedCost: toNumber(getValue(result, f.unitLandedCost)) || 0,
          totalUnitCost: toNumber(getValue(result, f.totalUnitCost)) || 0,
        });
        return true;
      });

    return rows;
  }

  function validateRow(row, mode) {
    const errors = [];
    if (!row.targetTypeText && !row.targetType) errors.push('Document Type is required');
    if (!row.amount || row.amount <= 0) errors.push('Amount is required and must be greater than zero');
    if (!row.subsidiary) errors.push('Subsidiary is required');
    if (mode === MODES.bill) {
      if (!row.vendor) errors.push('Vendor is required for Vendor Bill');
      if (!row.costItemMap) errors.push('LC Cost Category is required');
      if (!row.costCategory && !row.costCategoryText) {
        errors.push('Cost Category is required for landed-cost bill lines');
      }
      if (!row.billItem && !row.billItemText) errors.push('LC Cost Item is required for item bill lines');
    } else {
      const debitAccount = getJournalDebitAccount(row);
      const creditAccount = getJournalCreditAccount(row);
      if (!debitAccount) errors.push('Configured Debit Account is required for Journal Entry');
      if (!creditAccount) errors.push('Configured Credit Account is required for Journal Entry');
      if (debitAccount && creditAccount && debitAccount === creditAccount) {
        errors.push('Debit Account and Credit Account must be different');
      }
    }

    return errors;
  }

  function groupRows(rows, mode, createdRows) {
    const groupsByKey = {};
    const existingTransactionsByKey = buildExistingTransactionsByKey(createdRows || [], mode);
    rows.forEach((row) => {
      const key = buildGroupKey(row, mode);
      if (!groupsByKey[key]) {
        const existingTransaction = existingTransactionsByKey[key] || {};
        groupsByKey[key] = {
          key,
          mode,
          vendor: row.vendor,
          vendorText: row.vendorText,
          subsidiary: row.subsidiary,
          subsidiaryText: row.subsidiaryText,
          billType: row.billType,
          billTypeText: DEFAULTS.billTypeText,
          currency: row.currency,
          currencyText: row.currencyText,
          createdTransactionId: existingTransaction.id || '',
          createdTransactionType: existingTransaction.type || '',
          transactionNumber: existingTransaction.number || '',
          actionText: existingTransaction.id
            ? `Append to ${existingTransaction.type || 'Transaction'} ${existingTransaction.number || existingTransaction.id}`
            : 'Create new transaction',
          rows: [],
          existingRows: (createdRows || []).filter((createdRow) => buildGroupKey(createdRow, mode) === key),
          amount: 0,
        };
      }
      groupsByKey[key].rows.push(row);
      groupsByKey[key].amount += row.amount || 0;
    });

    return Object.keys(groupsByKey).map((key) => {
      const group = groupsByKey[key];
      group.amount = roundCurrency(group.amount);
      group.billLineCount = mode === MODES.bill ? buildMergedVendorBillRows(group.rows).length : group.rows.length;
      return group;
    });
  }

  function buildGroupKey(row, mode) {
    // A Vendor Bill has one currency and one header exchange rate. Source row rates are still
    // applied independently during base-currency GRN allocation, so rate differences must not
    // create duplicate same-vendor/same-currency bills.
    return mode === MODES.bill
      ? [row.vendor, row.subsidiary, row.currency].join('|')
      : [row.subsidiary, row.currency].join('|');
  }

  function buildExistingTransactionsByKey(rows, mode) {
    const transactionsByKey = {};
    rows.forEach((row) => {
      if (!row.createdTransactionId) return;
      const key = buildGroupKey(row, mode);
      if (transactionsByKey[key]) return;
      transactionsByKey[key] = {
        id: row.createdTransactionId,
        type: row.createdTransactionType || getModeText(mode),
        number: row.transactionNumber || row.createdTransactionId,
      };
    });
    return transactionsByKey;
  }

  function createVendorBill(group) {
    const bill = group.createdTransactionId
      ? record.load({ type: record.Type.VENDOR_BILL, id: group.createdTransactionId, isDynamic: true })
      : record.create({ type: record.Type.VENDOR_BILL, isDynamic: true });
    const firstRow = group.rows[0] || {};
    if (!group.createdTransactionId) {
      setIfPresent(bill, 'entity', group.vendor);
      setIfPresent(bill, 'subsidiary', group.subsidiary);
      setTransactionFieldByTextOrValue(
        bill,
        [TRANSACTION_FIELDS.vendorBill.billType],
        [group.billTypeText || DEFAULTS.billTypeText],
        []
      );
      setIfPresent(bill, 'currency', group.currency);
      setIfPresent(bill, 'exchangerate', firstRow.exchangeRate);
      setIfPresent(bill, 'trandate', toDateObject(firstRow.effectiveDate));
      setIfPresent(bill, 'memo', `LCM ${firstRow.memo || ''}`.trim());
    }

    // Cost Category must be stamped on the line as it is added. Tagging the line is what
    // makes the Bill selectable later as a landed cost source, so it is never gated on the
    // Bill already having something to allocate onto.
    const costLines = [];
    buildMergedVendorBillRows(group.rows).forEach((row) => {
      if (addOrMergeVendorBillItemLine(bill, row)) costLines.push(row);
    });

    // Evaluated after the lines exist; on a new Bill the item sublist is empty up to here.
    const existingRowsForBill = (group.existingRows || []).filter(
      (row) => !group.createdTransactionId || row.createdTransactionId === group.createdTransactionId
    );
    applyVendorBillNativeLandedCosts(
      bill,
      existingRowsForBill.concat(group.rows || []),
      firstRow.allocationMethodText,
      costLines
    );

    const id = bill.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return makeTransactionResult('Vendor Bill', record.Type.VENDOR_BILL, id, group.createdTransactionId ? 'Appended' : 'Created');
  }

  function buildMergedVendorBillRows(rows) {
    const mergedByKey = {};
    const order = [];

    (rows || []).forEach((row) => {
      const key = buildVendorBillLineKey(row);
      if (!mergedByKey[key]) {
        mergedByKey[key] = Object.assign({}, row, {
          amount: 0,
          memo: '',
          sourceRows: [],
          memoTexts: [],
          memoLookup: {},
        });
        order.push(key);
      }

      const merged = mergedByKey[key];
      merged.amount = roundCurrency((merged.amount || 0) + (row.amount || 0));
      merged.sourceRows.push(row);
      addDistinctMemo(merged, row.memo);
    });

    return order.map((key) => {
      const merged = mergedByKey[key];
      merged.memo = merged.memoTexts.join('; ') || merged.costCategoryText || merged.billItemText || '';
      delete merged.memoTexts;
      delete merged.memoLookup;
      return merged;
    });
  }

  function buildVendorBillLineKey(row) {
    return [
      row.vendor,
      row.subsidiary,
      row.currency,
      row.costCategory || row.costCategoryText,
      row.billItem || row.billItemText,
      row.allocationMethod || row.allocationMethodText,
    ]
      .map((value) => normalizeValue(value))
      .join('|');
  }

  function addDistinctMemo(merged, memo) {
    const memoText = normalizeValue(memo).trim();
    if (!memoText || merged.memoLookup[memoText]) return;
    merged.memoLookup[memoText] = true;
    merged.memoTexts.push(memoText);
  }

  function addOrMergeVendorBillItemLine(bill, row) {
    const existingLines = findMatchingVendorBillCostLines(bill, row);
    if (!existingLines.length) return addVendorBillItemLine(bill, row);

    const primaryLine = existingLines[0];
    const mergedAmount = roundCurrency(
      existingLines.reduce((total, line) => total + (toNumber(line.amount) || 0), 0) + (row.amount || 0)
    );
    const mergedMemo = mergeVendorBillLineDescriptions(
      existingLines.map((line) => line.description),
      row.memo || row.costCategoryText || row.billItemText
    );

    bill.selectLine({ sublistId: 'item', line: primaryLine.line });
    setCurrentIfPresent(bill, 'item', 'quantity', 1);
    setCurrentIfPresent(bill, 'item', 'rate', mergedAmount);
    setCurrentIfPresent(bill, 'item', 'amount', mergedAmount);
    setCurrentIfPresent(bill, 'item', 'description', mergedMemo);
    bill.commitLine({ sublistId: 'item' });

    // Remove duplicate generated lines after the first line has absorbed their amounts.
    for (let index = existingLines.length - 1; index > 0; index -= 1) {
      bill.removeLine({ sublistId: 'item', line: existingLines[index].line, ignoreRecalc: true });
    }

    return true;
  }

  function findMatchingVendorBillCostLines(bill, row) {
    const matches = [];
    const lineCount = getLineCount(bill, 'item');
    const billAllocationMethod = getVendorBillLandedCostMethodTextFromRecord(bill);
    const rowAllocationMethod = getVendorBillLandedCostMethodText(row.allocationMethodText);

    // A Vendor Bill stores the allocation method at header level, while category and item
    // are stored on each cost line. Do not merge across methods when the header exposes it.
    if (billAllocationMethod && rowAllocationMethod && billAllocationMethod !== rowAllocationMethod) return matches;

    for (let line = 0; line < lineCount; line += 1) {
      const category = getSublistValue(bill, 'item', 'landedcostcategory', line);
      const item = getSublistValue(bill, 'item', 'item', line);
      if (!matchesVendorBillLineField(category, getSublistText(bill, 'item', 'landedcostcategory', line), row.costCategory, row.costCategoryText)) {
        continue;
      }
      if (!matchesVendorBillLineField(item, getSublistText(bill, 'item', 'item', line), row.billItem, row.billItemText)) {
        continue;
      }

      matches.push({
        line,
        amount: getSublistValue(bill, 'item', 'amount', line),
        description: getSublistValue(bill, 'item', 'description', line),
      });
    }

    return matches;
  }

  function matchesVendorBillLineField(lineValue, lineText, rowValue, rowText) {
    const normalizedLineValue = normalizeValue(lineValue);
    const normalizedRowValue = normalizeValue(rowValue);
    if (normalizedLineValue && normalizedRowValue) return normalizedLineValue === normalizedRowValue;

    const normalizedLineText = normalizeValue(lineText).trim();
    const normalizedRowText = normalizeValue(rowText).trim();
    return Boolean(normalizedLineText && normalizedRowText && normalizedLineText === normalizedRowText);
  }

  function mergeVendorBillLineDescriptions(descriptions, fallback) {
    const merged = { memoTexts: [], memoLookup: {} };
    (descriptions || []).forEach((description) => addDistinctMemo(merged, description));
    addDistinctMemo(merged, fallback);
    return merged.memoTexts.join('; ');
  }

  function getVendorBillLandedCostMethodTextFromRecord(bill) {
    const fieldIds = getVendorBillLandedCostMethodFieldIds();
    for (let index = 0; index < fieldIds.length; index += 1) {
      const text = getRecordText(bill, fieldIds[index]);
      if (text) return getVendorBillLandedCostMethodText(text);
      const value = getRecordValue(bill, fieldIds[index]);
      if (value) return getVendorBillLandedCostMethodText(value);
    }
    return '';
  }

  function addVendorBillItemLine(bill, row) {
    bill.selectNewLine({ sublistId: 'item' });
    setCurrentSublistFieldByValueOrText(bill, 'item', 'item', [row.billItem], [row.billItemText]);
    setCurrentIfPresent(bill, 'item', 'quantity', 1);
    setCurrentIfPresent(bill, 'item', 'rate', row.amount);
    setCurrentIfPresent(bill, 'item', 'amount', row.amount);
    setCurrentIfPresent(bill, 'item', 'description', row.memo || row.costCategoryText);
    setClassifications(bill, 'item', row);
    // Set last: NetSuite re-sources the line when item/rate change, which can clear it.
    const taggedAsCost = setVendorBillLineCostCategory(bill, row);
    bill.commitLine({ sublistId: 'item' });
    return taggedAsCost;
  }

  function setVendorBillLineCostCategory(bill, row) {
    if (!row.costCategory && !row.costCategoryText) return false;
    const done = setCurrentSublistFieldByValueOrText(
      bill,
      'item',
      'landedcostcategory',
      [row.costCategory],
      [row.costCategoryText]
    );
    if (!done) {
      log.audit({
        title: 'LCM landed cost category not applied',
        details: `Landed Cost row ${row.id}: item line does not expose landedcostcategory, or category ${row.costCategoryText || row.costCategory} is not a Landed Cost type category. Item ${row.billItem} must be a non-inventory/service/other-charge item.`,
      });
    }
    return done;
  }

  function setCurrentSublistFieldByValueOrText(rec, sublistId, fieldId, values, texts) {
    for (let index = 0; index < (values || []).length; index += 1) {
      const value = values[index];
      if (value === null || value === undefined || value === '') continue;
      try {
        rec.setCurrentSublistValue({ sublistId, fieldId, value, ignoreFieldChange: false });
        return true;
      } catch (valueError) {
        // Fall through to the text representation.
      }
    }
    for (let index = 0; index < (texts || []).length; index += 1) {
      const text = texts[index];
      if (text === null || text === undefined || text === '') continue;
      try {
        rec.setCurrentSublistText({ sublistId, fieldId, text });
        return true;
      } catch (textError) {
        // Field is not exposed on this transaction form.
      }
    }
    return false;
  }

  function setVendorBillLandedCostMethod(bill, allocationMethodText) {
    const methodText = getVendorBillLandedCostMethodText(allocationMethodText);
    if (!methodText) return false;
    const fieldIds = getVendorBillLandedCostMethodFieldIds();
    let firstError = null;

    for (let fieldIndex = 0; fieldIndex < fieldIds.length; fieldIndex += 1) {
      const fieldId = fieldIds[fieldIndex];
      try {
        bill.setText({
          fieldId,
          text: methodText,
        });
        return true;
      } catch (textError) {
        if (!firstError) firstError = textError;
        const values = getVendorBillLandedCostMethodValues(methodText);
        for (let index = 0; index < values.length; index += 1) {
          try {
            bill.setValue({
              fieldId,
              value: values[index],
            });
            return true;
          } catch (valueError) {
            // Try the next known NetSuite representation for this standard select field.
          }
        }
      }
    }

    log.audit({
      title: 'LCM landed cost allocation method not applied',
      details: `Tried ${fieldIds.join(', ')} with "${methodText}". ${
        (firstError && firstError.message) || 'Field is not exposed on this Vendor Bill form.'
      }`,
    });
    return false;
  }

  function getVendorBillLandedCostMethodFieldIds() {
    const fieldIds = [TRANSACTION_FIELDS.vendorBill.landedCostMethod, 'landedCostMethod'];
    return fieldIds.filter((fieldId, index) => fieldId && fieldIds.indexOf(fieldId) === index);
  }

  function getVendorBillLandedCostMethodText(allocationMethodText) {
    const method = normalizeChoice(allocationMethodText);
    if (method.indexOf('quant') >= 0 || method.indexOf('qty') >= 0) return 'Quantity';
    if (method.indexOf('weight') >= 0) return 'Weight';
    return 'Value';
  }

  function getVendorBillLandedCostMethodValues(methodText) {
    if (methodText === 'Quantity') return ['QUANTITY', '_quantity', 'quantity'];
    if (methodText === 'Weight') return ['WEIGHT', '_weight', 'weight'];
    return ['VALUE', '_value', 'value'];
  }

  function applyVendorBillNativeLandedCosts(bill, rows, allocationMethodText, costLines) {
    // Cost Allocation Method describes how the tagged cost lines spread, so it is set as soon
    // as any line carries a Cost Category - not only when this Bill also carries the goods.
    const hasCostLines = (costLines || []).length > 0;
    if (hasCostLines) {
      setVendorBillLandedCostMethod(bill, allocationMethodText);
    }

    // The Landed Cost subtab summary (Source/Amount per category) only means anything when the
    // Bill also has inventory lines to absorb the cost. A pure freight/duty Bill has none; it is
    // consumed later as an "Other Transaction" source on the Item Receipt.
    if (!hasAllocatableVendorBillItemLines(bill)) return hasCostLines;

    applyVendorBillLandedCostSummary(bill, rows);
    return true;
  }

  function applyVendorBillLandedCostSummary(bill, rows) {
    const totalsByCategory = {};
    (rows || []).forEach((row) => {
      const categoryKey = row.costCategory || row.costCategoryText;
      if (!categoryKey) return;
      if (!totalsByCategory[categoryKey]) {
        totalsByCategory[categoryKey] = {
          id: row.costCategory,
          text: row.costCategoryText,
          amount: 0,
          hasExpense: false,
          hasItem: false,
        };
      }
      totalsByCategory[categoryKey].amount += row.amount || 0;
      totalsByCategory[categoryKey].hasItem = true;
    });

    Object.keys(totalsByCategory).forEach((costCategoryId) => {
      const entry = totalsByCategory[costCategoryId];
      const sourceText = entry.hasItem && !entry.hasExpense ? 'This Transaction' : 'Manual';
      setVendorBillLandedCostSource(bill, entry, sourceText);
      setVendorBillLandedCostAmount(bill, entry, roundCurrency(entry.amount));
    });
  }

  function setVendorBillLandedCostSource(bill, costCategory, sourceText) {
    const sourceFieldIds = getVendorBillLandedCostFieldIds(bill, 'source', costCategory);
    const sourceTexts = [sourceText || 'This Transaction'];
    const sourceValues =
      sourceText === 'Manual'
        ? ['MANUAL', 'Manual', 'manual']
        : ['THIS_TRANSACTION', 'This Transaction', 'thistransaction', 'transaction'];
    return setTransactionFieldByTextOrValue(bill, sourceFieldIds, sourceTexts, sourceValues);
  }

  function setVendorBillLandedCostAmount(bill, costCategory, amount) {
    if (amount === null || amount === undefined || amount === '') return false;
    const amountFieldIds = getVendorBillLandedCostFieldIds(bill, 'amount', costCategory);
    return setTransactionFieldByValue(bill, amountFieldIds, amount);
  }

  function getVendorBillLandedCostFieldIds(bill, kind, costCategory) {
    const resolvedSuffix = findLandedCostFieldSuffixByLabel(bill, costCategory.text);
    const suffix = resolvedSuffix || String(costCategory.id || '');
    const prefix = kind === 'source' ? 'landedcostsource' : 'landedcostamount';
    const fieldIds = suffix ? [`${prefix}${suffix}`, `${prefix}_${suffix}`] : [];
    return fieldIds.filter((fieldId, index) => fieldId && fieldIds.indexOf(fieldId) === index);
  }

  function findLandedCostFieldSuffixByLabel(rec, costCategoryText) {
    const normalizedCategory = normalizeChoice(costCategoryText);
    if (!normalizedCategory) return '';

    let fieldIds = [];
    try {
      fieldIds = rec.getFields() || [];
    } catch (error) {
      return '';
    }

    for (let index = 0; index < fieldIds.length; index += 1) {
      const fieldId = fieldIds[index];
      if (String(fieldId).indexOf('landedcostamount') !== 0) continue;

      try {
        const field = rec.getField({ fieldId });
        if (normalizeChoice(field && field.label) === normalizedCategory) {
          return String(fieldId).replace('landedcostamount', '');
        }
      } catch (error) {
        // Ignore fields that are not exposed on the active transaction form.
      }
    }

    return '';
  }

  function hasAllocatableVendorBillItemLines(bill) {
    const count = getLineCount(bill, 'item');
    for (let line = 0; line < count; line += 1) {
      const landedCostCategory = getSublistValue(bill, 'item', 'landedcostcategory', line);
      if (landedCostCategory) continue;

      const amount = toNumber(getSublistValue(bill, 'item', 'amount', line));
      const rate = toNumber(getSublistValue(bill, 'item', 'rate', line));
      if ((amount || 0) > 0 || (rate || 0) > 0) return true;
    }
    return false;
  }

  function getLineCount(rec, sublistId) {
    try {
      return rec.getLineCount({ sublistId }) || 0;
    } catch (error) {
      return 0;
    }
  }

  function getSublistValue(rec, sublistId, fieldId, line) {
    try {
      const value = rec.getSublistValue({ sublistId, fieldId, line });
      return value === null || value === undefined ? '' : value;
    } catch (error) {
      return '';
    }
  }

  function getSublistText(rec, sublistId, fieldId, line) {
    try {
      const text = rec.getSublistText({ sublistId, fieldId, line });
      return text === null || text === undefined ? '' : text;
    } catch (error) {
      return '';
    }
  }

  function setTransactionFieldByTextOrValue(rec, fieldIds, texts, values) {
    for (let fieldIndex = 0; fieldIndex < fieldIds.length; fieldIndex += 1) {
      const fieldId = fieldIds[fieldIndex];
      for (let textIndex = 0; textIndex < texts.length; textIndex += 1) {
        try {
          rec.setText({ fieldId, text: texts[textIndex] });
          return true;
        } catch (textError) {
          // Try the next known representation for this account-generated field.
        }
      }
      if (setTransactionFieldByValue(rec, [fieldId], values)) return true;
    }
    return false;
  }

  function setTransactionFieldByValue(rec, fieldIds, valueOrValues) {
    const values = Array.isArray(valueOrValues) ? valueOrValues : [valueOrValues];
    for (let fieldIndex = 0; fieldIndex < fieldIds.length; fieldIndex += 1) {
      const fieldId = fieldIds[fieldIndex];
      for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
        try {
          rec.setValue({ fieldId, value: values[valueIndex] });
          return true;
        } catch (valueError) {
          // Try the next known representation for this account-generated field.
        }
      }
    }
    return false;
  }

  function createJournalEntry(group) {
    const journal = group.createdTransactionId
      ? record.load({ type: record.Type.JOURNAL_ENTRY, id: group.createdTransactionId, isDynamic: true })
      : record.create({ type: record.Type.JOURNAL_ENTRY, isDynamic: true });
    const firstRow = group.rows[0] || {};
    if (!group.createdTransactionId) {
      setIfPresent(journal, 'subsidiary', group.subsidiary);
      setIfPresent(journal, 'currency', group.currency);
      setIfPresent(journal, 'exchangerate', firstRow.exchangeRate);
      setIfPresent(journal, 'trandate', toDateObject(firstRow.effectiveDate));
      setIfPresent(journal, 'memo', `LCM ${firstRow.memo || ''}`.trim());
    }

    group.rows.forEach((row) => {
      addJournalLine(journal, row, 'debit');
      addJournalLine(journal, row, 'credit');
    });

    const id = journal.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return makeTransactionResult('Journal Entry', record.Type.JOURNAL_ENTRY, id, group.createdTransactionId ? 'Appended' : 'Created');
  }

  function addJournalLine(journal, row, side) {
    journal.selectNewLine({ sublistId: 'line' });
    setJournalLineAccount(journal, row, side);
    setCurrentIfPresent(journal, 'line', side, row.amount);
    setCurrentIfPresent(journal, 'line', 'memo', row.memo || row.costCategoryText);
    setClassifications(journal, 'line', row);
    journal.commitLine({ sublistId: 'line' });
  }

  function getJournalDebitAccount(row) {
    return getJournalAccountCandidates(row, 'debit')[0] || '';
  }

  function getJournalCreditAccount(row) {
    return getJournalAccountCandidates(row, 'credit')[0] || '';
  }

  function setJournalLineAccount(journal, row, side) {
    const candidates = getJournalAccountCandidates(row, side);
    const failures = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const accountId = candidates[index];
      try {
        journal.setCurrentSublistValue({
          sublistId: 'line',
          fieldId: 'account',
          value: accountId,
        });
        return accountId;
      } catch (error) {
        failures.push(`${accountId}: ${error.message || error}`);
      }
    }

    throw new Error(
      `No valid Journal ${side} account was accepted for subsidiary ${row.subsidiary || '(none)'}. ` +
        `Tried: ${failures.join(' | ') || '(none)'}`
    );
  }

  function getJournalAccountCandidates(row, side) {
    const configured =
      side === 'debit' ? ACCOUNT_CONSTANTS.journalDebitAccount : ACCOUNT_CONSTANTS.journalCreditAccount;
    const autoAccounts = getAutoJournalAccountCandidates(row.subsidiary);
    const orderedAutoAccounts = side === 'credit' ? autoAccounts.slice(1).concat(autoAccounts.slice(0, 1)) : autoAccounts;
    return uniqueIds([configured].concat(orderedAutoAccounts));
  }

  function getAutoJournalAccountCandidates(subsidiaryId) {
    const cacheKey = normalizeValue(subsidiaryId) || 'any';
    if (journalAccountCandidatesCache[cacheKey]) return journalAccountCandidatesCache[cacheKey];

    const attempts = [
      {
        label: 'active non-summary accounts',
        filters: [
          ['isinactive', 'is', 'F'],
          'AND',
          ['issummary', 'is', 'F'],
        ],
      },
      {
        label: 'active accounts',
        filters: [['isinactive', 'is', 'F']],
      },
      {
        label: 'any accounts',
        filters: [],
      },
    ];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      try {
        const accountIds = [];
        search
          .create({
            type: search.Type.ACCOUNT,
            filters: attempt.filters,
            columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })],
          })
          .run()
          .each((result) => {
            accountIds.push(String(result.getValue({ name: 'internalid' }) || ''));
            return accountIds.length < 20;
          });
        const candidates = uniqueIds(accountIds);
        if (candidates.length) {
          journalAccountCandidatesCache[cacheKey] = candidates;
          return candidates;
        }
      } catch (error) {
        log.audit({
          title: 'LCM Journal account auto-search failed',
          details: `${attempt.label}: ${error.message || error}`,
        });
      }
    }

    journalAccountCandidatesCache[cacheKey] = [];
    return journalAccountCandidatesCache[cacheKey];
  }

  function uniqueIds(values) {
    const seen = {};
    const ids = [];
    values.forEach((value) => {
      const id = normalizeValue(value).trim();
      if (!id || seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    return ids;
  }

  function allocateCreatedCosts(parentId, rows, options) {
    const allocatableRows = (rows || []).filter((row) => row.targetMode === MODES.bill);
    if (!allocatableRows.length) return;
    const reset = Boolean(options && options.reset);

    const items = fetchTrackedItems(parentId);
    if (!items.length) throw new Error('No tracked LCM Items are available for landed-cost allocation.');

    const incrementsByItemId = {};
    items.forEach((item) => {
      incrementsByItemId[item.id] = 0;
    });

    allocatableRows.forEach((row) => {
      const weights = buildAllocationWeights(items, row.allocationMethodText);
      const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
      if (!totalWeight) return;

      const costAmount = (row.amount || 0) * (row.exchangeRate || 1);
      weights.forEach((entry) => {
        const allocated = costAmount * (entry.weight / totalWeight);
        incrementsByItemId[entry.item.id] += allocated / (entry.item.quantity || 1);
      });
    });

    items.forEach((item) => {
      const newUnitLandedCost = roundCurrency((reset ? 0 : item.unitLandedCost || 0) + incrementsByItemId[item.id]);
      const basePoRate = (item.poRate || 0) * (item.exchangeRate || 1);
      const totalUnitCost = roundCurrency(basePoRate + newUnitLandedCost);
      record.submitFields({
        type: RECORDS.lcmItems,
        id: item.id,
        values: {
          [FIELDS.lcmItems.unitLandedCost]: newUnitLandedCost,
          [FIELDS.lcmItems.totalUnitCost]: totalUnitCost,
          [FIELDS.lcmItems.totalValue]: roundCurrency(totalUnitCost * (item.quantity || 0)),
        },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    });
  }

  function buildAllocationWeights(items, methodText) {
    const method = normalizeChoice(methodText);
    return items.map((item) => {
      let weight = 1;
      if (method.indexOf('quant') >= 0 || method.indexOf('qty') >= 0) {
        weight = item.quantity || 1;
      } else if (method.indexOf('amount') >= 0 || method.indexOf('value') >= 0 || method.indexOf('rate') >= 0) {
        weight = (item.quantity || 1) * (item.poRate || 0) * (item.exchangeRate || 1);
      }
      return { item, weight: weight || 1 };
    });
  }

  function markCostRowsCreated(rows, transaction) {
    const f = FIELDS.lcmLandedCosts;
    rows.forEach((row) => {
      record.submitFields({
        type: RECORDS.lcmLandedCosts,
        id: row.id,
        values: {
          [f.processingStatus]: STATUS.created,
          [f.createdTransactionId]: String(transaction.id),
          [f.createdTransactionRef]: String(transaction.id),
          [f.createdTransactionType]: transaction.label,
          [f.transactionNumber]: transaction.tranid || String(transaction.id),
          [f.createdDate]: new Date(),
        },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    });
  }

  function markCostRowsAllocated(rows) {
    const f = FIELDS.lcmLandedCosts;
    rows.forEach((row) => {
      record.submitFields({
        type: RECORDS.lcmLandedCosts,
        id: row.id,
        values: {
          [f.costAllocatedInGrn]: true,
        },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    });
  }

  function makeTransactionResult(label, type, id, action) {
    return {
      label,
      type,
      id: String(id),
      action: action || 'Created',
      tranid: lookupTranId(type, id),
    };
  }

  function lookupTranId(type, id) {
    try {
      const values = search.lookupFields({ type, id, columns: ['tranid'] });
      return String(values.tranid || id);
    } catch (error) {
      return String(id);
    }
  }

  function setClassifications(rec, sublistId, row) {
    setCurrentIfPresent(rec, sublistId, 'location', row.location);
  }

  function setIfPresent(rec, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    rec.setValue({ fieldId, value });
  }

  function setCurrentIfPresent(rec, sublistId, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    rec.setCurrentSublistValue({ sublistId, fieldId, value });
  }

  function getValue(result, name) {
    return result.getValue({ name });
  }

  function getText(result, name) {
    return result.getText({ name }) || '';
  }

  function getRecordValue(rec, fieldId) {
    try {
      const value = rec.getValue({ fieldId });
      return value === null || value === undefined ? '' : String(value);
    } catch (error) {
      return '';
    }
  }

  function getRecordText(rec, fieldId) {
    try {
      const text = rec.getText({ fieldId });
      return text === null || text === undefined ? '' : String(text);
    } catch (error) {
      return '';
    }
  }

  function toDateObject(value) {
    if (!value) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') return value;

    try {
      return format.parse({
        value: String(value),
        type: format.Type.DATE,
      });
    } catch (error) {
      return value;
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

  return {
    MODES,
    STATUS,
    buildPreview,
    buildAllocationPreview,
    createTransactions,
    fetchLandedCostRows,
    getAllocationMethodDefault,
    getCostItemMapDefaults,
    getSelectedPurchaseOrderDefaults,
    getVendorBillDefaults,
    getVendorCurrencyDefaults,
    getVendorDefaults,
    listCostCategoryItemMatches,
    normalizeMode,
    recalculateAllocatedCosts,
  };
});
