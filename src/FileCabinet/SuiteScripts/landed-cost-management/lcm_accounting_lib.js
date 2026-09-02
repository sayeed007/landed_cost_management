/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/format', 'N/log', 'N/record', 'N/search', './lcm_po_selection_config'], (format, log, record, search, config) => {
  const { RECORDS, FIELDS, TRANSACTION_FIELDS, ACCOUNT_CONSTANTS } = config;
  const STATUS = {
    pending: 'Pending',
    created: 'Created',
  };
  const MODES = {
    bill: 'bill',
    journal: 'journal',
  };
  const vendorDefaultsCache = {};
  const costProfileDefaultsCache = {};
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
      errors: [],
      groups: [],
    };

    if (!preview.parentId) {
      preview.errors.push('Missing Landed Cost Management record ID.');
      return preview;
    }

    assertParentAccessible(preview.parentId);
    const rows = fetchLandedCostRows(parentId).filter((row) => row.targetMode === mode);
    const trackedItems = fetchTrackedItems(parentId);
    preview.allocationTargetCount = trackedItems.length;

    if (!rows.length) {
      preview.errors.push(`No Landed Cost rows are marked for ${preview.modeText}.`);
      return preview;
    }

    const createdRows = [];
    rows.forEach((row) => {
      if (row.isCreated) {
        createdRows.push(row);
        preview.skippedRows.push({
          id: row.id,
          reason: `Already created: ${row.createdTransactionType || 'Transaction'} ${
            row.transactionNumber || row.createdTransactionId || ''
          }`,
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

    if (preview.eligibleRows.length && !trackedItems.length) {
      preview.errors.push('At least one LCM Item row must have Track Item checked before creating accounting.');
    }

    preview.groups = groupRows(preview.eligibleRows, mode, createdRows);
    preview.ok = preview.errors.length === 0 && preview.eligibleRows.length > 0;
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
    preview.groups.forEach((group) => {
      const transaction =
        preview.mode === MODES.bill ? createVendorBill(group) : createJournalEntry(group);
      markCostRowsCreated(group.rows, transaction);
      createdRows.push(...group.rows);
      created.push(transaction);
    });
    allocateCreatedCosts(parentId, createdRows);
    markCostRowsAllocated(createdRows);

    return {
      mode: preview.mode,
      modeText: preview.modeText,
      created,
      processedRowCount: preview.eligibleRows.length,
      skippedRows: preview.skippedRows,
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
      f.costProfile,
      f.costCategory,
      f.amount,
      f.currency,
      f.exchangeRate,
      f.effectiveDate,
      f.allocationMethod,
      f.expenseAccount,
      f.billItem,
      f.debitAccount,
      f.creditAccount,
      f.department,
      f.class,
      f.location,
      f.memo,
      f.transactionNumber,
      f.processingStatus,
      f.createdTransactionId,
      f.createdTransactionType,
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
          costProfile: getValue(result, f.costProfile),
          costProfileText: getText(result, f.costProfile),
          costCategory: getValue(result, f.costCategory),
          costCategoryText: getText(result, f.costCategory),
          amount: toNumber(getValue(result, f.amount)),
          currency: getValue(result, f.currency),
          currencyText: getText(result, f.currency),
          exchangeRate: toNumber(getValue(result, f.exchangeRate)) || 1,
          effectiveDate: getValue(result, f.effectiveDate),
          allocationMethod: getValue(result, f.allocationMethod),
          allocationMethodText: getText(result, f.allocationMethod),
          expenseAccount: getValue(result, f.expenseAccount),
          expenseAccountText: getText(result, f.expenseAccount),
          billItem: getValue(result, f.billItem),
          billItemText: getText(result, f.billItem),
          debitAccount: getValue(result, f.debitAccount),
          creditAccount: getValue(result, f.creditAccount),
          department: getValue(result, f.department),
          class: getValue(result, f.class),
          location: getValue(result, f.location),
          memo: getValue(result, f.memo),
          transactionNumber: getValue(result, f.transactionNumber),
          processingStatus: status,
          createdTransactionId,
          createdTransactionType: getValue(result, f.createdTransactionType),
          isCreated: normalizeChoice(status) === normalizeChoice(STATUS.created) || Boolean(createdTransactionId),
        });
        return true;
      });

    return rows.map((row) => enrichRow(row, parentDefaults));
  }

  function getParentAccountingDefaults(parentId) {
    try {
      const rec = record.load({
        type: RECORDS.landedCostManagement,
        id: parentId,
        isDynamic: false,
      });
      return {
        vendor: getRecordValue(rec, FIELDS.landedCostManagement.vendor),
        vendorText: getRecordText(rec, FIELDS.landedCostManagement.vendor),
        subsidiary: getRecordValue(rec, FIELDS.landedCostManagement.subsidiary),
        subsidiaryText: getRecordText(rec, FIELDS.landedCostManagement.subsidiary),
      };
    } catch (error) {
      return {};
    }
  }

  function enrichRow(row, parentDefaults) {
    if (!row.vendor && parentDefaults.vendor) {
      row.vendor = parentDefaults.vendor;
      row.vendorText = parentDefaults.vendorText || row.vendorText;
    }
    if (!row.subsidiary && parentDefaults.subsidiary) {
      row.subsidiary = parentDefaults.subsidiary;
      row.subsidiaryText = parentDefaults.subsidiaryText || row.subsidiaryText;
    }
    applyCostProfileDefaults(row);
    return enrichRowFromVendor(row);
  }

  function enrichRowFromVendor(row) {
    if (!row.vendor) return row;

    const defaults = getVendorDefaults(row.vendor);
    if (!row.subsidiary && defaults.subsidiary) {
      row.subsidiary = defaults.subsidiary;
      row.subsidiaryText = defaults.subsidiaryText || row.subsidiaryText;
    }
    if (!row.expenseAccount && defaults.expenseAccount) {
      row.expenseAccount = defaults.expenseAccount;
    }

    return row;
  }

  function applyCostProfileDefaults(row) {
    const defaults = getCostProfileDefaults(
      row.costProfile || row.costCategory,
      row.costProfileText || row.costCategoryText
    );
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

  function getCostProfileDefaults(costCategoryId, costCategoryText) {
    const categoryId = normalizeValue(costCategoryId);
    const categoryText = normalizeValue(costCategoryText) || lookupCostCategoryName(categoryId);
    const cacheKey = `${categoryId}|${categoryText}`;
    if (costProfileDefaultsCache[cacheKey]) return costProfileDefaultsCache[cacheKey];

    const billItem = findActiveItemByExactName(categoryText);
    const defaults = {
      costCategory: categoryId,
      costCategoryText: categoryText,
      billItem: billItem.id,
      billItemText: billItem.text,
      attemptedItemName: categoryText,
      matched: Boolean(billItem.id),
      reason: billItem.reason || '',
    };

    log[defaults.matched ? 'audit' : 'error']({
      title: `LCM LC Cost Profile ${defaults.matched ? 'resolved' : 'did NOT resolve'} an LC Cost Item`,
      details:
        `Cost Profile internal id: ${categoryId || '(none)'}. ` +
        `Cost Profile text: "${categoryText || '(none)'}". ` +
        `Attempted item name: "${defaults.attemptedItemName || '(none)'}". ` +
        `Result: ${
          defaults.matched ? `item ${defaults.billItem} ("${defaults.billItemText}")` : 'no item set'
        }. Reason: ${defaults.reason || '(none)'}`,
    });

    costProfileDefaultsCache[cacheKey] = defaults;
    return defaults;
  }

  function lookupCostCategoryName(costCategoryId) {
    if (!costCategoryId) return '';
    const attempts = [
      { type: 'costcategory', columns: ['name'] },
      { type: 'landedcostcategory', columns: ['name'] },
    ];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      try {
        const values = search.lookupFields({
          type: attempt.type,
          id: costCategoryId,
          columns: attempt.columns,
        });
        const name = extractLookupText(values.name) || extractLookupValue(values.name);
        if (name) return name;
      } catch (error) {
        // Account-specific category records can expose different search type names.
      }
    }
    return '';
  }

  function findActiveItemByExactName(itemName) {
    const name = normalizeValue(itemName).trim();
    if (!name) {
      return { id: '', text: '', reason: 'LC Cost Profile carried no text to match an item name against.' };
    }

    // `name` is not a searchable field on an item search and throws. `itemid` is Name/Number,
    // `displayname` is Display Name; those are the two an exact match can run against.
    const attempts = [['itemid', 'is', name], ['displayname', 'is', name]];
    const tried = [];

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      try {
        const results = search
          .create({
            type: 'item',
            filters: [['isinactive', 'is', 'F'], 'AND', attempt],
            columns: ['internalid', 'itemid', 'displayname'],
          })
          .run()
          .getRange({ start: 0, end: 2 });

        if (results && results.length) {
          const result = results[0];
          return {
            id: normalizeValue(result.getValue({ name: 'internalid' })),
            text:
              normalizeValue(result.getValue({ name: 'itemid' })) ||
              normalizeValue(result.getValue({ name: 'displayname' })) ||
              name,
            reason:
              results.length > 1
                ? `Matched on ${attempt[0]}, but more than one active item carries this name. Took the first.`
                : `Matched on ${attempt[0]}.`,
          };
        }
        tried.push(`${attempt[0]} is "${name}" -> 0 rows`);
      } catch (searchError) {
        tried.push(`${attempt[0]} is "${name}" -> ${searchError.message || searchError}`);
      }
    }

    const reason =
      `No active item matched. Tried ${tried.join('; ')}. Confirm the item is active and its ` +
      `Name/Number equals the LC Cost Profile text exactly. A subitem's Name/Number includes its ` +
      `parent ("Parent : ${name}"), so a subitem will not match on itemid.`;
    return { id: '', text: name, reason };
  }

  function getVendorDefaults(vendorId) {
    if (!vendorId) return {};
    if (vendorDefaultsCache[vendorId]) return vendorDefaultsCache[vendorId];

    const subsidiary = lookupVendorField(vendorId, 'subsidiary');
    const expenseAccount = lookupVendorField(vendorId, 'expenseaccount');
    const currency = lookupFirstVendorField(vendorId, ['currency', 'defaultcurrency']);

    vendorDefaultsCache[vendorId] = {
      subsidiary: subsidiary.value,
      subsidiaryText: subsidiary.text,
      currency: currency.value,
      currencyText: currency.text,
      expenseAccount: expenseAccount.value,
      expenseAccountText: expenseAccount.text,
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
        expenseAccount: defaults.expenseAccount,
        expenseAccountText: defaults.expenseAccountText,
      };
      return billDefaults;
    } catch (error) {
      return defaults;
    }
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
          f.expectedQuantityReceipt,
          f.poRate,
          f.exchangeRate,
          f.unitLandedCost,
          f.totalUnitCost,
        ],
      })
      .run()
      .each((result) => {
        rows.push({
          id: getValue(result, 'internalid'),
          quantity: toNumber(getValue(result, f.expectedQuantityReceipt)) || 1,
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
    if (!row.targetTypeText && !row.targetType) errors.push('Target Type is required');
    if (!row.amount || row.amount <= 0) errors.push('Amount is required and must be greater than zero');
    if (!row.subsidiary) errors.push('Subsidiary is required');
    if (mode === MODES.bill) {
      const lineType = normalizeChoice(row.billLineTypeText || row.billLineType);
      if (!row.vendor) errors.push('Vendor is required for Vendor Bill');
      if (!row.billType) errors.push('Bill Type is required for Vendor Bill');
      if (!lineType) errors.push('Bill Line Type is required');
      if (!row.costProfile && !row.costProfileText) errors.push('LC Cost Profile is required');
      if (!row.costCategory && !row.costCategoryText) {
        errors.push('Cost Category is required for landed-cost bill lines');
      }
      if (lineType.indexOf('expense') >= 0 && !row.expenseAccount) {
        errors.push('Expense Account is required for expense bill lines');
      }
      if (lineType.indexOf('item') >= 0 && !row.billItem && !row.billItemText) {
        errors.push('Bill Item is required for item bill lines');
      }
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
          billTypeText: row.billTypeText,
          currency: row.currency,
          currencyText: row.currencyText,
          createdTransactionId: existingTransaction.id || '',
          createdTransactionType: existingTransaction.type || '',
          transactionNumber: existingTransaction.number || '',
          actionText: existingTransaction.id
            ? `Append to ${existingTransaction.type || 'Transaction'} ${existingTransaction.number || existingTransaction.id}`
            : 'Create new transaction',
          rows: [],
          amount: 0,
        };
      }
      groupsByKey[key].rows.push(row);
      groupsByKey[key].amount += row.amount || 0;
    });

    return Object.keys(groupsByKey).map((key) => {
      const group = groupsByKey[key];
      group.amount = roundCurrency(group.amount);
      return group;
    });
  }

  function buildGroupKey(row, mode) {
    return mode === MODES.bill
      ? [row.vendor, row.subsidiary, row.billType, row.currency].join('|')
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
      setIfPresent(bill, TRANSACTION_FIELDS.vendorBill.billType, group.billType);
      setIfPresent(bill, 'trandate', toDateObject(firstRow.effectiveDate));
      setIfPresent(bill, 'memo', `LCM ${firstRow.memo || ''}`.trim());
    }

    // Cost Category must be stamped on the line as it is added. Tagging the line is what
    // makes the Bill selectable later as a landed cost source, so it is never gated on the
    // Bill already having something to allocate onto.
    const costLines = [];
    group.rows.forEach((row) => {
      const lineType = normalizeChoice(row.billLineTypeText || row.billLineType);
      if (lineType.indexOf('item') >= 0) {
        if (addVendorBillItemLine(bill, row)) costLines.push(row);
      } else {
        addVendorBillExpenseLine(bill, row);
      }
    });

    // Evaluated after the lines exist; on a new Bill the item sublist is empty up to here.
    applyVendorBillNativeLandedCosts(bill, group.rows, firstRow.allocationMethodText, costLines);

    const id = bill.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return makeTransactionResult('Vendor Bill', record.Type.VENDOR_BILL, id, group.createdTransactionId ? 'Appended' : 'Created');
  }

  function addVendorBillExpenseLine(bill, row) {
    bill.selectNewLine({ sublistId: 'expense' });
    setCurrentSublistFieldByValueOrText(bill, 'expense', 'account', [row.expenseAccount], [row.expenseAccountText]);
    setCurrentIfPresent(bill, 'expense', 'amount', row.amount);
    setCurrentIfPresent(bill, 'expense', 'memo', row.memo || row.costCategoryText);
    setClassifications(bill, 'expense', row);
    bill.commitLine({ sublistId: 'expense' });
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
      if (normalizeChoice(row.billLineTypeText || row.billLineType).indexOf('item') >= 0) {
        totalsByCategory[categoryKey].hasItem = true;
      } else {
        totalsByCategory[categoryKey].hasExpense = true;
      }
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
    const rowAccount = side === 'debit' ? row.debitAccount : row.creditAccount;
    const autoAccounts = getAutoJournalAccountCandidates(row.subsidiary);
    const orderedAutoAccounts = side === 'credit' ? autoAccounts.slice(1).concat(autoAccounts.slice(0, 1)) : autoAccounts;
    return uniqueIds([configured, rowAccount].concat(orderedAutoAccounts));
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

  function allocateCreatedCosts(parentId, rows) {
    const items = fetchTrackedItems(parentId);
    if (!items.length) throw new Error('No tracked LCM Items are available for landed-cost allocation.');

    const incrementsByItemId = {};
    items.forEach((item) => {
      incrementsByItemId[item.id] = 0;
    });

    rows.forEach((row) => {
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
      const newUnitLandedCost = roundCurrency((item.unitLandedCost || 0) + incrementsByItemId[item.id]);
      const basePoRate = (item.poRate || 0) * (item.exchangeRate || 1);
      record.submitFields({
        type: RECORDS.lcmItems,
        id: item.id,
        values: {
          [FIELDS.lcmItems.unitLandedCost]: newUnitLandedCost,
          [FIELDS.lcmItems.totalUnitCost]: roundCurrency(basePoRate + newUnitLandedCost),
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
    setCurrentIfPresent(rec, sublistId, 'department', row.department);
    setCurrentIfPresent(rec, sublistId, 'class', row.class);
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
    createTransactions,
    fetchLandedCostRows,
    getAllocationMethodDefault,
    getCostProfileDefaults,
    getVendorBillDefaults,
    getVendorDefaults,
    normalizeMode,
  };
});
