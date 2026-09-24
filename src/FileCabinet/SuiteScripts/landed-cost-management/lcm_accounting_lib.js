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
  const inventoryDetailFlagsCache = {};
  const defaultInventoryStatusCache = {};

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
            row.createdTransactionRefText || row.createdTransactionId || ''
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

    if (mode === MODES.bill && preview.eligibleRows.length && hasCreatedItemReceipts(preview.parentId)) {
      preview.errors.push(
        'This LCM record already has an Item Receipt. Create a new LCM record for additional landed-cost Bills so the GRN allocation remains auditable.'
      );
    }

    preview.groups = groupRows(preview.eligibleRows, mode, createdRows);
    if (mode === MODES.bill) {
      findAllocationMethodConflicts(preview.groups).forEach((conflict) => preview.errors.push(conflict));
      annotateVendorBillLineActions(preview.groups);
    }
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

    // Two phases. Every transaction is built and fully validated in memory first, so a line
    // that cannot be tagged or marked aborts while nothing at all has been saved - which is
    // what lets that failure say, truthfully, that no Vendor Bill was written.
    //
    // Saving is still one record at a time; NetSuite has no transaction spanning several
    // records. A failure during the save phase is therefore reported with exactly what had
    // already been written, rather than left for the user to work out.
    const prepared = preview.groups.map((group) =>
      preview.mode === MODES.bill ? prepareVendorBill(group) : prepareJournalEntry(group)
    );

    const created = [];
    const createdRows = [];
    let allocatedRowCount = 0;
    prepared.forEach((entry, index) => {
      let transaction;
      try {
        transaction = entry.save();
      } catch (error) {
        throw buildPartialCreateError(error, created, index, prepared.length, 'could not be saved');
      }
      created.push(transaction);

      try {
        markCostRowsCreated(entry.group.rows, transaction);
      } catch (error) {
        // The transaction exists but its rows do not point at it, so a later run would build
        // a second one. That has to be said out loud rather than swallowed.
        throw buildPartialCreateError(
          error,
          created,
          index,
          prepared.length,
          `was saved as ${transaction.label} ${transaction.tranid || transaction.id}, but its Landed Cost rows could not be marked Created. Set their Created Transaction to that id before running this again, or a duplicate will be created`
        );
      }
      createdRows.push(...entry.group.rows);
    });
    if (preview.mode === MODES.bill) {
      const rowsForAllocation = getCreatedBillRows(parentId);
      allocateCreatedCosts(parentId, rowsForAllocation, { reset: true });
      const finalized = finalizeCostAllocationAfterReceipts(parentId, rowsForAllocation);
      shipmentStatus.recalculate(parentId);
      allocatedRowCount = finalized.allocatedRowCount;
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

  function buildPartialCreateError(error, created, index, total, what) {
    const detail = (error && error.message) || String(error);
    const alreadySaved = created.slice(0, index);
    const preamble = `Transaction ${index + 1} of ${total} ${what}.`;
    if (!alreadySaved.length) {
      return new Error(`${preamble} Nothing else was saved.\n${detail}`);
    }
    return new Error(
      `${preamble}\n\nThe ${alreadySaved.length} transaction(s) saved before it were kept: ` +
        `${alreadySaved.map((transaction) => `${transaction.label} ${transaction.tranid || transaction.id}`).join(', ')}. ` +
        'Their Landed Cost rows are marked Created, so re-running this action will append to them ' +
        `rather than duplicate them, and will retry the remaining ${total - index} transaction(s).\n${detail}`
    );
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
    const finalized = finalizeCostAllocationAfterReceipts(parentId, preview.createdBillRows);
    shipmentStatus.recalculate(parentId);

    return {
      mode: preview.mode,
      modeText: preview.modeText,
      created: [],
      processedRowCount: 0,
      allocatedRowCount: finalized.allocatedRowCount,
      pendingAllocatedRowCount: preview.unallocatedCreatedRows.length,
      skippedRows: [],
      allocationTargetCount: preview.allocationTargetCount,
    };
  }

  function buildItemReceiptPreview(parentId) {
    const preview = {
      ok: false,
      mode: 'itemReceipt',
      modeText: 'Item Receipt',
      parentId: String(parentId || ''),
      allocationTargetCount: 0,
      createdBillRows: [],
      pendingBillRows: [],
      receiptItems: [],
      groups: [],
      inventoryDetailRequirements: [],
      shipmentNumber: '',
      skippedRows: [],
      errors: [],
    };

    if (!preview.parentId) {
      preview.errors.push('Missing Landed Cost Management record ID.');
      return preview;
    }

    assertParentAccessible(preview.parentId);
    preview.shipmentNumber = getParentShipmentNumber(preview.parentId);
    const billRows = fetchLandedCostRows(preview.parentId).filter((row) => row.targetMode === MODES.bill);
    preview.createdBillRows = billRows.filter((row) => row.isCreated);
    preview.pendingBillRows = billRows.filter((row) => !row.isCreated);
    preview.receiptItems = fetchLcmReceiptItems(preview.parentId);
    preview.allocationTargetCount = preview.receiptItems.filter((row) => row.trackItem).length;

    if (!billRows.length) {
      preview.errors.push('Add and create at least one Bill-type Landed Cost row before creating Item Receipts.');
    }
    if (preview.pendingBillRows.length) {
      preview.errors.push(
        `Create all Bill-type Landed Cost rows first. Pending rows: ${preview.pendingBillRows.map((row) => row.id).join(', ')}.`
      );
    }
    if (!preview.receiptItems.length) {
      preview.errors.push('No LCM Item row has a positive Quantity Receipt to receive.');
    }
    if (preview.createdBillRows.length && !preview.allocationTargetCount) {
      preview.errors.push('At least one LCM Item row must have Track Item checked before creating Item Receipts with landed cost.');
    }

    const groupsByPo = {};
    preview.receiptItems.forEach((row) => {
      if (!row.purchaseOrderId || !row.itemId || !row.poLineKey) {
        preview.errors.push(
          `LCM Item ${row.id} is missing its PO, Item, or PO Line Key and cannot be transformed into an Item Receipt.`
        );
        return;
      }
      if (!groupsByPo[row.purchaseOrderId]) {
        groupsByPo[row.purchaseOrderId] = {
          key: row.purchaseOrderId,
          purchaseOrderId: row.purchaseOrderId,
          purchaseOrderText: row.purchaseOrderText || row.purchaseOrderId,
          exchangeRate: row.exchangeRate || 1,
          currencyText: row.poCurrencyText || '',
          rows: [],
          action: 'Create',
          existingReceiptId: '',
          existingReceiptNumber: '',
          landedCosts: [],
          baseLandedCostAmount: 0,
        };
      }
      groupsByPo[row.purchaseOrderId].rows.push(row);
    });

    Object.keys(groupsByPo).forEach((poId) => {
      const group = groupsByPo[poId];
      const receiptIds = uniqueIds(group.rows.map((row) => row.itemReceiptId));
      if (receiptIds.length > 1) {
        preview.errors.push(`LCM Items for PO ${group.purchaseOrderText} point to more than one Item Receipt.`);
      } else if (receiptIds.length === 1) {
        group.existingReceiptId = receiptIds[0];
        group.existingReceiptNumber =
          group.rows.find((row) => row.itemReceiptId === receiptIds[0]).itemReceiptText || receiptIds[0];
        group.action = 'Already received';
      } else {
        const existingReceipt = findGeneratedItemReceipt(preview.parentId, group.purchaseOrderId);
        if (existingReceipt) {
          group.existingReceiptId = existingReceipt.id;
          group.existingReceiptNumber = existingReceipt.tranid || existingReceipt.id;
          group.action = 'Relink existing receipt';
        }
      }
    });

    if (!preview.errors.length && preview.createdBillRows.length) {
      const allocation = buildReceiptLandedCostAllocations(preview.receiptItems, preview.createdBillRows);
      preview.errors.push(...allocation.errors);
      if (!allocation.errors.length) {
        Object.keys(groupsByPo).forEach((poId) => {
          const group = groupsByPo[poId];
          const poAllocation = allocation.byPurchaseOrder[poId] || { landedCosts: [], baseAmount: 0 };
          group.landedCosts = poAllocation.landedCosts;
          group.baseLandedCostAmount = poAllocation.baseAmount;
          group.allocationMethodText = allocation.allocationMethodText;
        });
      }
    }

    preview.groups = Object.keys(groupsByPo).map((poId) => groupsByPo[poId]);
    if (!preview.errors.length) {
      preview.groups
        .filter((group) => group.action === 'Create')
        .forEach((group) => {
          const requirements = inspectItemReceiptInventoryDetails(group);
          requirements.forEach((requirement) => {
            requirement.autoReceiptInventoryNumber = requirement.isSerial
              ? ''
              : buildAutomaticReceiptInventoryNumber(preview.shipmentNumber, requirement);
            getInventoryDetailAutomationErrors(requirement).forEach((error) => preview.errors.push(error));
          });
          group.inventoryDetailRequirements = requirements;
          preview.inventoryDetailRequirements.push(...requirements);
        });
    }
    const actionableGroups = preview.groups.filter((group) => group.action !== 'Already received');
    if (!preview.errors.length && !actionableGroups.length) {
      preview.errors.push('Every LCM Item with a positive Quantity Receipt is already linked to an Item Receipt.');
    }
    preview.ok = preview.errors.length === 0;
    return preview;
  }

  function createItemReceipts(parentId) {
    const preview = buildItemReceiptPreview(parentId);
    if (!preview.ok) {
      const error = new Error(preview.errors.join('\n') || 'No Item Receipts are ready to create.');
      error.preview = preview;
      throw error;
    }

    // Transform every PO and validate its exact source lines before saving the first receipt.
    // A source-line or Landed Cost form problem must not create a partial GRN run.
    const prepared = preview.groups
      .filter((group) => group.action === 'Create')
      .map((group) => prepareItemReceipt(group, preview.parentId, preview.shipmentNumber));
    const created = [];

    preview.groups
      .filter((group) => group.action === 'Relink existing receipt')
      .forEach((group) => {
        linkLcmItemsToItemReceipt(group.rows, group.existingReceiptId);
        created.push({
          label: 'Item Receipt',
          type: record.Type.ITEM_RECEIPT,
          id: String(group.existingReceiptId),
          tranid: group.existingReceiptNumber || String(group.existingReceiptId),
          action: 'Relinked',
        });
      });

    prepared.forEach((entry, index) => {
      let transaction;
      try {
        transaction = entry.save();
      } catch (error) {
        throw buildPartialCreateError(error, created, index, prepared.length, 'could not be saved');
      }
      created.push(transaction);
      try {
        linkLcmItemsToItemReceipt(entry.group.rows, transaction.id);
      } catch (error) {
        throw buildPartialCreateError(
          error,
          created,
          index,
          prepared.length,
          `was saved as Item Receipt ${transaction.tranid || transaction.id}, but its LCM Item rows could not be linked. Re-running Create Item Receipt will relink the marked receipt instead of creating another one`
        );
      }
    });

    const allReceiptItems = fetchLcmReceiptItems(parentId);
    const createdBillRows = getCreatedBillRows(parentId);
    allocateCreatedCosts(parentId, createdBillRows, { reset: true });
    const finalized = finalizeCostAllocationAfterReceipts(parentId, createdBillRows, allReceiptItems);
    shipmentStatus.recalculate(parentId);

    return {
      mode: preview.mode,
      modeText: preview.modeText,
      created,
      processedRowCount: preview.receiptItems.length,
      allocatedRowCount: finalized.allocatedRowCount,
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

  function getParentShipmentNumber(parentId) {
    try {
      const rec = record.load({
        type: RECORDS.landedCostManagement,
        id: parentId,
        isDynamic: false,
      });
      return (
        normalizeValue(getRecordValue(rec, 'name')).trim() ||
        normalizeValue(getRecordValue(rec, FIELDS.landedCostManagement.shipmentNumber)).trim() ||
        `LCM-${parentId}`
      );
    } catch (error) {
      return `LCM-${parentId}`;
    }
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
      f.memo,
      f.processingStatus,
      f.createdTransactionId,
      f.createdTransactionRef,
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
          // Needed to build the Vendor Bill line ownership marker.
          parentId: String(parentId),
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
          memo: getValue(result, f.memo),
          processingStatus: status,
          createdTransactionId,
          createdTransactionRefText: getText(result, f.createdTransactionRef),
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
    row.costItemMap = normalizeValue(row.costItemMap).trim();
    row.costItemMapMatched = false;
    row.costItemMapReason = '';
    row.mappedItemId = '';
    row.mappedItemText = '';
    if (!row.costItemMap) return row;

    const defaults = getCostItemMapDefaults(row.costItemMap);
    row.costItemMapReason = defaults.reason || '';
    // matched means the mapping record resolved AND it yielded both a Cost Category and an
    // active LC Cost Item. Anything less leaves the row's hidden derived fields holding
    // whatever was sourced onto them previously, which validateRow then refuses to trust.
    row.costItemMapMatched = Boolean(defaults.matched);
    if (!defaults.mappingRecordId) return row;

    // The mapping record is the source of truth for both derived fields. The hidden native
    // Cost Category and LC Cost Item sourced onto a child row can be stale, or simply differ
    // between rows carrying the same mapping, so they are rehydrated here - before validation
    // and before any merge key is built - instead of only being filled in when blank. Rows
    // that share a mapping share one cached defaults object, so they cannot drift apart.
    row.costItemMapText = defaults.costItemMapText || row.costItemMapText;

    // Identity-only copy of the mapped item. It is kept even when that item is inactive, so a
    // mapping whose item no longer resolves still yields one stable discriminator for every
    // child row. Line creation keeps using the active item in row.billItem.
    row.mappedItemId = normalizeValue(defaults.mappedItemId);
    row.mappedItemText = normalizeValue(defaults.mappedItemText);

    if (defaults.costCategory || defaults.costCategoryText) {
      row.costCategory = defaults.costCategory || row.costCategory;
      row.costCategoryText = defaults.costCategoryText || row.costCategoryText;
    }
    if (defaults.billItem || defaults.billItemText) {
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
      // Raw mapped item straight off the mapping record, retained even when it is inactive so
      // callers can still build a stable identity for it.
      mappedItemId: normalizeValue(map.billItem),
      mappedItemText: normalizeValue(map.billItemText),
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

  function fetchLcmItemRows(parentId) {
    if (!parentId) return [];
    const f = FIELDS.lcmItems;
    const rows = [];

    search
      .create({
        type: RECORDS.lcmItems,
        filters: [[f.parent, 'anyof', parentId]],
        columns: [
          'internalid',
          f.purchaseOrder,
          f.item,
          f.quantityReceipt,
          f.poRate,
          f.exchangeRate,
          f.poCurrencyText,
          f.trackItem,
          f.unitLandedCost,
          f.totalUnitCost,
          f.poLineKey,
          f.itemReceipt,
        ],
      })
      .run()
      .each((result) => {
        rows.push({
          id: getValue(result, 'internalid'),
          purchaseOrderId: getValue(result, f.purchaseOrder),
          purchaseOrderText: getText(result, f.purchaseOrder),
          itemId: getValue(result, f.item),
          itemText: getText(result, f.item),
          quantity: toNumber(getValue(result, f.quantityReceipt)),
          poRate: toNumber(getValue(result, f.poRate)) || 0,
          exchangeRate: toNumber(getValue(result, f.exchangeRate)) || 1,
          poCurrencyText: getValue(result, f.poCurrencyText) || '',
          trackItem: isChecked(getValue(result, f.trackItem)),
          unitLandedCost: toNumber(getValue(result, f.unitLandedCost)) || 0,
          totalUnitCost: toNumber(getValue(result, f.totalUnitCost)) || 0,
          poLineKey: getValue(result, f.poLineKey) || '',
          itemReceiptId: getValue(result, f.itemReceipt) || '',
          itemReceiptText: getText(result, f.itemReceipt),
        });
        return true;
      });

    return rows;
  }

  function fetchTrackedItems(parentId) {
    return fetchLcmItemRows(parentId)
      .filter((row) => row.trackItem && (row.quantity === null || row.quantity > 0))
      .map((row) =>
        Object.assign({}, row, {
          quantity: row.quantity === null ? 1 : row.quantity,
        })
      );
  }

  function fetchLcmReceiptItems(parentId) {
    return fetchLcmItemRows(parentId).filter((row) => row.quantity !== null && row.quantity > 0);
  }

  function validateRow(row, mode) {
    const errors = [];
    if (!row.targetTypeText && !row.targetType) errors.push('Document Type is required');
    if (!row.amount || row.amount <= 0) errors.push('Amount is required and must be greater than zero');
    if (!row.subsidiary) errors.push('Subsidiary is required');
    if (mode === MODES.bill) {
      if (!row.vendor) errors.push('Vendor is required for Vendor Bill');
      if (!row.costItemMap) {
        errors.push('LC Cost Category is required');
      } else if (!row.costItemMapMatched) {
        // The hidden native Cost Category and LC Cost Item are only ever as trustworthy as
        // the mapping they were derived from. When the mapping is inactive, missing, or
        // points at an inactive item, whatever is still sitting in those hidden fields is
        // stale and must not be used to build a Vendor Bill line.
        errors.push(
          `LC Cost Category mapping ${row.costItemMap} did not resolve, so the hidden Cost Category and LC Cost Item cannot be trusted: ${
            row.costItemMapReason || 'the mapping is inactive, missing, or points at an inactive LC Cost Item'
          }`
        );
      }
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
      if (mode !== MODES.bill) {
        group.billLineCount = group.rows.length;
        group.billLines = [];
        return group;
      }

      const mergedRows = buildMergedVendorBillRows(group.rows);
      group.billLineCount = mergedRows.length;
      group.billLines = mergedRows.map((merged) => ({
        sourceRowIds: merged.sourceRowIds,
        costCategoryText: merged.costCategoryText || merged.costItemMapText || '',
        billItemText: merged.billItemText || '',
        allocationMethodText: getVendorBillLandedCostMethodText(merged.allocationMethodText),
        amount: merged.amount,
        lineKey: merged.lineKey,
      }));
      return group;
    });
  }

  // Cost Allocation Method is a BODY field on a Vendor Bill, but Bills are grouped by vendor,
  // subsidiary and currency only. Rows that disagree about the method therefore cannot be
  // represented on one Bill: whichever method is written to the header governs every cost
  // line on it, including the lines that asked for the other one. Splitting the lines does
  // not fix that, so the mismatch is refused in the preview instead of being written out.
  function findAllocationMethodConflicts(groups) {
    const conflicts = [];
    (groups || []).forEach((group) => {
      const conflict = describeAllocationMethodConflict((group.rows || []).concat(group.existingRows || []));
      if (!conflict) return;
      conflicts.push(`${group.vendorText || group.vendor} / ${group.currencyText || group.currency}: ${conflict}`);
    });
    return conflicts;
  }

  function describeAllocationMethodConflict(rows) {
    const rowIdsByMethod = {};
    (rows || []).forEach((row) => {
      const method = getVendorBillLandedCostMethodText(row.allocationMethodText);
      if (!rowIdsByMethod[method]) rowIdsByMethod[method] = [];
      rowIdsByMethod[method].push(row.id);
    });

    const methods = Object.keys(rowIdsByMethod);
    if (methods.length < 2) return '';
    return (
      'a Vendor Bill has one Cost Allocation Method, but these Landed Cost rows ask for ' +
      `${methods.map((method) => `${method} (row ${rowIdsByMethod[method].join(', ')})`).join(' and ')}. ` +
      'Set one Allocation Method for this vendor/currency, or move the differing rows onto their own ' +
      'LCM record so they get their own Vendor Bill.'
    );
  }

  // For a group appending to an existing Vendor Bill, say per line whether it will merge into
  // a line already on that Bill or add a new one, and when it will not merge, show the markers
  // the Bill actually carries next to the one being looked for. "Why did appending add a line
  // instead of merging?" can only be answered by reading the Bill, so the preview reads it.
  function annotateVendorBillLineActions(groups) {
    (groups || []).forEach((group) => {
      if (!group.createdTransactionId || !(group.billLines || []).length) return;

      let bill;
      try {
        bill = record.load({ type: record.Type.VENDOR_BILL, id: group.createdTransactionId, isDynamic: false });
      } catch (error) {
        group.billLines.forEach((line) => {
          line.action = `Vendor Bill ${group.createdTransactionId} could not be read: ${error.message || error}`;
        });
        return;
      }

      const markersOnBill = listVendorBillLineSourceKeys(bill);
      buildMergedVendorBillRows(group.rows).forEach((mergedRow, index) => {
        const line = group.billLines[index];
        if (!line) return;

        line.expectedSourceKey = buildVendorBillSourceKey(mergedRow);
        const divergentLines = [];
        const diagnostics = [];
        const matches = findMatchingVendorBillCostLines(bill, mergedRow, { divergentLines, diagnostics });
        if (matches.length) {
          line.action = `Merge into existing line ${matches.map((match) => match.line + 1).join(', ')}`;
          return;
        }

        line.willAddNewLine = true;
        line.markersOnBill = markersOnBill;
        // The matcher says why, line by line. Nothing here is inferred.
        line.diagnostics = diagnostics;
        line.action = 'Add a new line';
      });
    });
  }

  function listVendorBillLineSourceKeys(bill) {
    const count = getLineCount(bill, 'item');
    const keys = [];
    for (let line = 0; line < count; line += 1) {
      const key = getVendorBillLineSourceKey(bill, line);
      if (key && keys.indexOf(key) < 0) keys.push(key);
    }
    return keys;
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
        number: row.createdTransactionRefText || row.createdTransactionId,
      };
    });
    return transactionsByKey;
  }

  // Builds the Vendor Bill without saving it and hands back a save() the caller runs once
  // every group has been built successfully.
  function prepareVendorBill(group) {
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
    const mergedRows = buildMergedVendorBillRows(group.rows);
    logVendorBillMergePlan(
      group.createdTransactionId
        ? `Append to Vendor Bill ${group.createdTransactionId} (group ${group.key})`
        : `New Vendor Bill (group ${group.key})`,
      mergedRows
    );
    // Rows already created against this Bill. Their amounts are what proves which of the
    // Bill's existing lines this LCM record owns, so they are needed before any line is
    // merged into or removed.
    const existingRowsForBill = (group.existingRows || []).filter(
      (row) => !group.createdTransactionId || row.createdTransactionId === group.createdTransactionId
    );

    // Each merged row carries its own marker, so a row can only ever match the line written
    // for its own merge group - including against a line written moments ago in this same
    // run. No extra guard is needed to keep distinct merge groups on distinct lines.
    mergedRows.forEach((row) => {
      if (addOrMergeVendorBillItemLine(bill, row)) costLines.push(row);
    });

    applyVendorBillNativeLandedCosts(
      bill,
      existingRowsForBill.concat(group.rows || []),
      firstRow.allocationMethodText,
      costLines
    );

    return {
      group,
      save() {
        const id = bill.save({ enableSourcing: true, ignoreMandatoryFields: false });
        return makeTransactionResult(
          'Vendor Bill',
          record.Type.VENDOR_BILL,
          id,
          group.createdTransactionId ? 'Appended' : 'Created'
        );
      },
    };
  }

  function buildMergedVendorBillRows(rows) {
    const mergedByKey = {};
    const order = [];

    (rows || []).forEach((row) => {
      const key = buildVendorBillLineKey(row);
      if (!mergedByKey[key]) {
        // Object.assign keeps the FIRST source row's Effective Date, Location, Department and
        // Class. Those fields deliberately stay out of the key, so they must not be allowed to
        // change once the merge group exists.
        mergedByKey[key] = Object.assign({}, row, {
          lineKey: key,
          amount: 0,
          memo: '',
          sourceRows: [],
          sourceRowIds: [],
          memoTexts: [],
          memoLookup: {},
        });
        order.push(key);
      }

      const merged = mergedByKey[key];
      merged.amount = roundCurrency((merged.amount || 0) + (row.amount || 0));
      merged.sourceRows.push(row);
      merged.sourceRowIds.push(row.id);
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

  function logVendorBillMergePlan(context, mergedRows) {
    const rows = mergedRows || [];
    const plan = rows.map(
      (merged) => `${merged.sourceRowIds.join('+')} -> qty 1 @ ${merged.amount} [${merged.lineKey}]`
    );
    const sourceCount = rows.reduce((total, merged) => total + merged.sourceRows.length, 0);
    log.audit({
      title: 'LCM Vendor Bill source merge plan',
      details: `${context}. Source rows: ${sourceCount}. Bill lines: ${rows.length}. ${plan.join(' | ')}`,
    });
  }

  function buildVendorBillLineKey(row) {
    return [
      identitySegment('ven', row.vendor, row.vendorText),
      identitySegment('sub', row.subsidiary, row.subsidiaryText),
      identitySegment('cur', row.currency, row.currencyText),
      buildCostIdentity(row),
      // The EFFECTIVE method, not the raw list value. A Vendor Bill is governed by the one
      // method written to its header, and that is this normalized text - so two rows NetSuite
      // will allocate identically belong on one line even when their list values differ. The
      // field is form-disabled and defaulted, so a row can easily end up blank ('' -> Value)
      // beside one holding the Value list id, and keying on the raw value split those into
      // two lines with nothing to show for it. This is also exactly what the mixed-method
      // refusal compares, so the key and the refusal can no longer disagree.
      identitySegment('mth', '', getVendorBillLandedCostMethodText(row.allocationMethodText)),
    ].join('|');
  }

  // Canonical, deterministic identity for the cost a Landed Cost row carries. Internal IDs win
  // over display text, because the same record can render with different text on different
  // rows (sourced vs. typed, parent-prefixed item names, mapping-record name vs. category
  // name). Text is only a fallback for a value that has no internal ID at all.
  function buildCostIdentity(row) {
    const category = identitySegment('cat', row.costCategory, row.costCategoryText);
    const item = identitySegment(
      'itm',
      row.billItem || row.mappedItemId,
      row.billItemText || row.mappedItemText
    );
    // Neither derived field resolved. Fall back to the mapping record, which is the field the
    // user actually picked and so the last deterministic identity available.
    if (category === 'cat|-' && item === 'itm|-') {
      return identitySegment('map', row.costItemMap, row.costItemMapText);
    }
    return `${category}+${item}`;
  }

  // '#' marks an internal ID, '~' a normalized label, '-' an unknown value. The field prefix
  // stops segments colliding with each other once they are joined into a single key.
  function identitySegment(prefix, value, text) {
    const id = normalizeValue(value).trim();
    if (id) return `${prefix}|#${id}`;
    const label = normalizeChoice(text);
    if (label) return `${prefix}|~${label}`;
    return `${prefix}|-`;
  }

  // The ownership marker stamped on every generated landed-cost line. It names the LCM record
  // and the exact merge group, so a line either is this record's line for this group or it is
  // not - there is nothing to infer. Amount arithmetic was tried here first and is not a
  // proof: a generated 600 line beside a manually added 400 line reconciles perfectly against
  // a 1,000 source total while identifying neither line.
  function buildVendorBillSourceKey(row) {
    const parentId = normalizeValue(row.parentId).trim();
    if (!parentId) return '';
    return `LCM${parentId}::${row.lineKey || buildVendorBillLineKey(row)}`;
  }

  function listSublistFieldIds(rec, sublistId) {
    try {
      const fieldIds = rec.getSublistFields({ sublistId }) || [];
      return fieldIds.join(', ') || '(none reported)';
    } catch (error) {
      return `(could not be listed: ${error.message || error})`;
    }
  }

  function getVendorBillLineSourceKey(bill, line) {
    return normalizeValue(getSublistValue(bill, 'item', TRANSACTION_FIELDS.vendorBillLine.sourceKey, line)).trim();
  }

  function setVendorBillLineSourceKey(bill, row) {
    const fieldId = TRANSACTION_FIELDS.vendorBillLine.sourceKey;
    const sourceKey = buildVendorBillSourceKey(row);
    if (!sourceKey) {
      log.error({
        title: 'LCM Vendor Bill line marker could not be built',
        details: `Landed Cost row ${row.id} has no parent record id, so no ownership marker could be built for its Vendor Bill line.`,
      });
      return false;
    }

    setCurrentSublistFieldByValueOrText(bill, 'item', fieldId, [sourceKey], [sourceKey]);

    // Read back and compare exactly. A setter that does not throw has not necessarily
    // written anything: the column may be absent from the form, or silently truncated. An
    // unmarked line is invisible to every later append, which would then add a duplicate line,
    // and it cannot be consolidated again without the user re-attesting to it.
    const applied = normalizeValue(getCurrentSublistValueSafe(bill, 'item', fieldId)).trim();
    if (applied === sourceKey) return true;

    log.error({
      title: 'LCM Vendor Bill line marker not applied',
      details:
        `Landed Cost row ${row.id}: wrote "${sourceKey}" to ${fieldId} but read back "${applied}". ` +
        `The column is missing from this Vendor Bill form, or it rejected the value. ` +
        `Item sublist columns on this form: ${listSublistFieldIds(bill, 'item')}`,
    });
    return false;
  }

  // Cost Category and ownership marker, applied in the only order that survives NetSuite's
  // re-sourcing and both verified by reading them back. Returns '' when the line is good, or
  // the reason it is not. A cost line without its category can never act as a landed cost
  // source, and one without its marker can never be recognised again, so a line missing
  // either is not worth committing.
  function applyVendorBillCostLineIdentity(bill, row) {
    // Category first: it is what NetSuite re-sources when item, rate or amount change, so it
    // has to go on after those. The marker is a plain text column and does not re-source.
    if (!setVendorBillLineCostCategory(bill, row)) return describeUntaggedCostLine(row);
    if (!setVendorBillLineSourceKey(bill, row)) return describeUnmarkedCostLine(row);

    // Re-read the category: writing the marker must not have disturbed it.
    const category = normalizeValue(getCurrentSublistValueSafe(bill, 'item', 'landedcostcategory')).trim();
    if (!category) return describeUntaggedCostLine(row);

    return '';
  }


  // Compares one identity-bearing field between a Vendor Bill line and a Landed Cost row.
  // Returns 'match', 'mismatch', or 'unknown' when the two sides share no comparable form.
  function compareCostIdentity(lineValue, lineText, rowValue, rowText) {
    const lineId = normalizeValue(lineValue).trim();
    const rowId = normalizeValue(rowValue).trim();
    if (lineId && rowId) return lineId === rowId ? 'match' : 'mismatch';

    const lineLabel = normalizeChoice(lineText);
    const rowLabel = normalizeChoice(rowText);
    if (lineLabel && rowLabel) return lineLabel === rowLabel ? 'match' : 'mismatch';

    return 'unknown';
  }

  function addDistinctMemo(merged, memo) {
    const memoText = normalizeValue(memo).trim();
    if (!memoText || merged.memoLookup[memoText]) return;
    merged.memoLookup[memoText] = true;
    merged.memoTexts.push(memoText);
  }

  function addOrMergeVendorBillItemLine(bill, row, options) {
    const lineKey = row.lineKey || buildVendorBillLineKey(row);
    const sourceRowIds = (row.sourceRowIds || [row.id]).join('+');
    // Every match is provably this LCM record's own line for this merge group. Anything else
    // on the Bill is invisible here and is never rewritten or removed.
    const divergentLines = [];
    const existingLines = findMatchingVendorBillCostLines(bill, row, { divergentLines });

    function addNewLineInstead(reason) {
      log.audit({
        title: 'LCM Vendor Bill existing line match',
        details: `Adding a new item line for Landed Cost rows ${sourceRowIds} at ${row.amount}. Key: ${lineKey}. Reason: ${reason}`,
      });
      return addVendorBillItemLine(bill, row);
    }

    if (!existingLines.length) {
      const markersOnBill = listVendorBillLineSourceKeys(bill);
      return addNewLineInstead(
        divergentLines.length
          ? `line ${divergentLines.map((entry) => entry.line).join(', ')} carries this merge key but its item has since been changed to "${divergentLines[0].itemText}", so it was left untouched`
          : `no line on this Bill carries the marker ${buildVendorBillSourceKey(row)}. Markers present: ${
              markersOnBill.length ? markersOnBill.join(' | ') : '(none)'
            }`
      );
    }

    const existingAmount = sumVendorBillLineAmounts(existingLines);
    const mergedAmount = roundCurrency(existingAmount + (row.amount || 0));
    const mergedMemo = mergeVendorBillLineDescriptions(
      existingLines.map((line) => line.description),
      row.memo || row.costCategoryText || row.billItemText
    );

    if (!writeVendorBillCostLine(bill, existingLines, row, mergedAmount, mergedMemo)) {
      return addNewLineInstead(
        'the consolidated line could not be tagged with its Cost Category, so the existing lines were left untouched'
      );
    }

    log.audit({
      title: 'LCM Vendor Bill existing line match',
      details:
        `Merged Landed Cost rows ${sourceRowIds} into existing line ${existingLines[0].line}. Key: ${lineKey}. ` +
          `Matched lines: ${existingLines.map((line) => `${line.line}(${line.reason})`).join(', ')}. ` +
          `Amount ${existingAmount} + ${row.amount || 0} = ${mergedAmount}.`,
    });

    return true;
  }

  // Writes one consolidated cost line: quantity 1, rate and amount equal to totalAmount, the
  // merged description, and the row's Cost Category re-stamped. Every matched line after the
  // first is removed once the first has absorbed the total.
  //
  // Returns false, having cancelled the line so the Bill is untouched, when the consolidated
  // line cannot be tagged with its Cost Category. Consolidation is destructive and the tag is
  // the whole point of the line, so collapsing several lines into one untagged line - losing
  // the separate lines and gaining nothing - is never an acceptable outcome. The check has to
  // happen before the commit, because afterwards the amount has already moved and skipping
  // the removals would inflate the Bill.
  function writeVendorBillCostLine(bill, existingLines, row, totalAmount, description) {
    const primaryLine = existingLines[0];

    bill.selectLine({ sublistId: 'item', line: primaryLine.line });
    setCurrentIfPresent(bill, 'item', 'quantity', 1);
    setCurrentIfPresent(bill, 'item', 'rate', totalAmount);
    setCurrentIfPresent(bill, 'item', 'amount', totalAmount);
    setCurrentIfPresent(bill, 'item', 'description', description);

    // Applied last and verified: NetSuite re-sources the line when rate or amount change, and
    // a consolidated line that lost its category or its marker is worse than the lines it
    // replaced.
    const problem = applyVendorBillCostLineIdentity(bill, row);
    if (problem) {
      log.error({ title: 'LCM Vendor Bill line consolidation abandoned', details: problem });
      cancelCurrentLine(bill);
      return false;
    }

    bill.commitLine({ sublistId: 'item' });

    // Descending, so the line indexes captured before the removals stay valid.
    for (let index = existingLines.length - 1; index > 0; index -= 1) {
      bill.removeLine({ sublistId: 'item', line: existingLines[index].line, ignoreRecalc: true });
    }

    return true;
  }

  function cancelCurrentLine(rec) {
    try {
      rec.cancelLine({ sublistId: 'item' });
      return true;
    } catch (error) {
      log.error({
        title: 'LCM Vendor Bill line could not be cancelled',
        details: `The pending item line was left uncommitted: ${error.message || error}`,
      });
      return false;
    }
  }

  function sumVendorBillLineAmounts(lines) {
    return roundCurrency((lines || []).reduce((total, line) => total + (toNumber(line.amount) || 0), 0));
  }

  // Ownership is decided by the line's own marker, never inferred. A line stamped with this
  // row's source key is this LCM record's line for this merge group. A line stamped with any
  // other key belongs to another LCM record, and a line with no marker was not written by
  // this tool at all. Only the first is ever merged into or removed.
  //
  // Every line this tool writes is marked, and a line that cannot be marked aborts the run,
  // so a generated line without a marker does not exist.
  function findMatchingVendorBillCostLines(bill, row, options) {
    const matches = [];
    const lineCount = getLineCount(bill, 'item');
    // Optional out-parameter: marked lines whose item no longer matches, for the caller to
    // report. They are never returned as matches.
    const divergentLines = (options && options.divergentLines) || null;
    // Optional out-parameter: why each line was or was not a match, so a caller never has to
    // infer a reason it cannot see.
    const diagnostics = (options && options.diagnostics) || null;
    const sourceKey = buildVendorBillSourceKey(row);

    // There was a guard here comparing the Bill's header Cost Allocation Method against the
    // row's, and returning no matches when they differed. It predates the marker and is now
    // both redundant and harmful: the effective method is part of the merge key, so it is
    // part of the marker, so two rows with different methods already cannot match. All the
    // guard could still do was reject on a header value that disagreed with the row - for a
    // header this tool wrote from the first row of the group - and return before comparing a
    // single line. The marker is the authority; nothing else gets a veto.
    if (diagnostics) {
      diagnostics.push(`Looking for marker ${sourceKey || '(this row has no parent id, so no marker could be built)'} across ${lineCount} item line(s).`);
    }

    for (let line = 0; line < lineCount; line += 1) {
      const category = getSublistValue(bill, 'item', 'landedcostcategory', line);
      const item = getSublistValue(bill, 'item', 'item', line);
      const categoryText = getSublistText(bill, 'item', 'landedcostcategory', line);
      const itemText = getSublistText(bill, 'item', 'item', line);
      const description = getSublistValue(bill, 'item', 'description', line);
      const hasCategory = Boolean(normalizeValue(category).trim() || normalizeChoice(categoryText));
      const lineSourceKey = getVendorBillLineSourceKey(bill, line);

      // No marker, or another LCM record's marker: not this record's line for this group.
      if (!sourceKey || lineSourceKey !== sourceKey) {
        if (diagnostics) {
          diagnostics.push(`Line ${line + 1}: marker ${lineSourceKey ? `"${lineSourceKey}"` : '(blank)'} is not the one being looked for.`);
        }
        continue;
      }

      // The marker proves who wrote the line. It does not prove the line still holds what
      // was written: the item can be edited afterwards while the column stays put, and
      // adding an amount to an item the Landed Cost row does not name would be wrong in a
      // way nobody would notice. Such a line is reported and left alone.
      if (compareCostIdentity(item, itemText, row.billItem, row.billItemText) !== 'match') {
        if (divergentLines) {
          divergentLines.push({
            line,
            itemText: itemText || item,
            expectedItemText: row.billItemText || row.billItem,
          });
        }
        log.error({
          title: 'LCM Vendor Bill marked line no longer carries its own item',
          details: `Line ${line} carries marker ${lineSourceKey} but its item is now "${itemText || item}" instead of "${row.billItemText || row.billItem}". It is left untouched.`,
        });
        if (diagnostics) {
          diagnostics.push(`Line ${line + 1}: marker matches, but its item is "${itemText || item}" instead of "${row.billItemText || row.billItem}".`);
        }
        continue;
      }

      if (diagnostics) diagnostics.push(`Line ${line + 1}: marker and item both match.`);
      matches.push({
        line,
        amount: getSublistValue(bill, 'item', 'amount', line),
        description,
        hasCategory,
      });
    }

    return matches;
  }

  // Descriptions are merged part by part, splitting on the same separator they were joined
  // with. A line description is usually already a merge of several memos, so comparing whole
  // strings would re-append memos that are present inside it and grow the description every
  // time a row is appended. Part-wise merging is idempotent.
  function mergeVendorBillLineDescriptions(descriptions, fallback) {
    const merged = { memoTexts: [], memoLookup: {} };
    (descriptions || []).concat([fallback]).forEach((description) => {
      normalizeValue(description)
        .split(';')
        .forEach((part) => addDistinctMemo(merged, part));
    });
    return merged.memoTexts.join('; ');
  }

  function addVendorBillItemLine(bill, row) {
    bill.selectNewLine({ sublistId: 'item' });
    setCurrentSublistFieldByValueOrText(bill, 'item', 'item', [row.billItem], [row.billItemText]);
    setCurrentIfPresent(bill, 'item', 'quantity', 1);
    setCurrentIfPresent(bill, 'item', 'rate', row.amount);
    setCurrentIfPresent(bill, 'item', 'amount', row.amount);
    setCurrentIfPresent(bill, 'item', 'description', row.memo || row.costCategoryText);
    // Applied last, because NetSuite re-sources the line when item, rate or amount change.
    const problem = applyVendorBillCostLineIdentity(bill, row);
    if (problem) {
      // Not a partial success. A line missing its category can never be picked up as a
      // landed cost source, and one missing its marker can never be recognised again, so
      // committing either would save a Bill that looks right, mark the source rows Created,
      // and quietly deliver nothing. Fail instead, before anything is saved.
      cancelCurrentLine(bill);
      throw new Error(problem);
    }
    bill.commitLine({ sublistId: 'item' });
    return true;
  }

  function describeUnmarkedCostLine(row) {
    return (
      `Landed Cost row ${row.id}: the Vendor Bill item line could not be stamped with its LCM ` +
      `Source Key (${TRANSACTION_FIELDS.vendorBillLine.sourceKey}). No Vendor Bill was saved. Without ` +
      'that marker the line cannot be recognised later, so appending to this Bill would add a ' +
      'duplicate line instead of merging. Check that the LCM Source Key transaction column is ' +
      'deployed and applies to purchase transactions.'
    );
  }

  function describeUntaggedCostLine(row) {
    return (
      `Landed Cost row ${row.id}: the Vendor Bill item line could not be tagged with Cost Category ` +
      `"${row.costCategoryText || row.costCategory}". No Vendor Bill was saved. All three must hold: ` +
      'the Landed Cost feature is enabled at Setup > Company > Enable Features > Items & Inventory; ' +
      `the Cost Category is of type Landed Cost; and LC Cost Item ${row.billItemText || row.billItem} is a ` +
      'non-inventory, service, or other-charge item rather than an inventory item.'
    );
  }

  function setVendorBillLineCostCategory(bill, row) {
    // row.costCategory has already been rehydrated from the mapping record, so a stale hidden
    // Cost Category on the child row can never reach the Bill line. The mapping record name is
    // kept as a last text fallback for accounts that label the category the same way.
    const values = [row.costCategory];
    const texts = [row.costCategoryText, row.costItemMapText];
    if (!values.some(Boolean) && !texts.some(Boolean)) return false;

    setCurrentSublistFieldByValueOrText(bill, 'item', 'landedcostcategory', values, texts);

    // Read back instead of trusting the setter: some forms accept the write and then drop it
    // when the category is not a Landed Cost category or the item cannot carry one.
    const applied = Boolean(normalizeValue(getCurrentSublistValueSafe(bill, 'item', 'landedcostcategory')).trim());
    if (!applied) {
      log.audit({
        title: 'LCM landed cost category not applied',
        details: `Landed Cost row ${row.id}: item line does not expose landedcostcategory, or category ${row.costCategoryText || row.costCategory} is not a Landed Cost type category. Item ${row.billItem} must be a non-inventory/service/other-charge item.`,
      });
    }
    return applied;
  }

  function getCurrentSublistValueSafe(rec, sublistId, fieldId) {
    try {
      const value = rec.getCurrentSublistValue({ sublistId, fieldId });
      return value === null || value === undefined ? '' : value;
    } catch (error) {
      return '';
    }
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

  function prepareJournalEntry(group) {
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

    return {
      group,
      save() {
        const id = journal.save({ enableSourcing: true, ignoreMandatoryFields: false });
        return makeTransactionResult(
          'Journal Entry',
          record.Type.JOURNAL_ENTRY,
          id,
          group.createdTransactionId ? 'Appended' : 'Created'
        );
      },
    };
  }

  function addJournalLine(journal, row, side) {
    journal.selectNewLine({ sublistId: 'line' });
    setJournalLineAccount(journal, row, side);
    setCurrentIfPresent(journal, 'line', side, row.amount);
    setCurrentIfPresent(journal, 'line', 'memo', row.memo || row.costCategoryText);
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

  function hasCreatedItemReceipts(parentId) {
    return fetchLcmReceiptItems(parentId).some((row) => Boolean(row.itemReceiptId));
  }

  function buildReceiptLandedCostAllocations(receiptItems, costRows) {
    const result = {
      errors: [],
      allocationMethodText: '',
      byPurchaseOrder: {},
    };
    const trackedItems = (receiptItems || []).filter((row) => row.trackItem);
    if (!trackedItems.length) {
      result.errors.push('At least one LCM Item row must have Track Item checked before landed cost can be applied to Item Receipts.');
      return result;
    }

    const methods = uniqueIds(
      (costRows || []).map((row) => getVendorBillLandedCostMethodText(row.allocationMethodText))
    );
    if (methods.length > 1) {
      result.errors.push(
        `Item Receipt landed cost requires one effective Allocation Method, but the created Bill rows use ${methods.join(', ')}. Use one method on this LCM record, or create separate LCM records.`
      );
      return result;
    }
    result.allocationMethodText = methods[0] || 'Value';

    const baseByPoAndCategory = {};
    (costRows || []).forEach((row) => {
      if (!row.costCategory && !row.costCategoryText) {
        result.errors.push(`Created Landed Cost row ${row.id} has no Cost Category for Item Receipt allocation.`);
        return;
      }
      const weights = buildAllocationWeights(trackedItems, row.allocationMethodText);
      const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
      if (!totalWeight) {
        result.errors.push(`Created Landed Cost row ${row.id} has no valid allocation weight.`);
        return;
      }

      const categoryKey = row.costCategory || row.costCategoryText;
      const baseCostAmount = (row.amount || 0) * (row.exchangeRate || 1);
      weights.forEach((entry) => {
        const poId = entry.item.purchaseOrderId;
        if (!poId) {
          result.errors.push(`Tracked LCM Item ${entry.item.id} has no Purchase Order for Item Receipt allocation.`);
          return;
        }
        if (!baseByPoAndCategory[poId]) baseByPoAndCategory[poId] = {};
        if (!baseByPoAndCategory[poId][categoryKey]) {
          baseByPoAndCategory[poId][categoryKey] = {
            costCategory: row.costCategory,
            costCategoryText: row.costCategoryText,
            baseAmount: 0,
            exchangeRates: {},
          };
        }
        const category = baseByPoAndCategory[poId][categoryKey];
        category.baseAmount += baseCostAmount * (entry.weight / totalWeight);
        category.exchangeRates[String(entry.item.exchangeRate || 1)] = true;
      });
    });

    if (result.errors.length) return result;

    Object.keys(baseByPoAndCategory).forEach((poId) => {
      const categories = baseByPoAndCategory[poId];
      const landedCosts = [];
      let baseAmount = 0;
      Object.keys(categories).forEach((categoryKey) => {
        const category = categories[categoryKey];
        const exchangeRates = Object.keys(category.exchangeRates);
        if (exchangeRates.length !== 1) {
          result.errors.push(
            `Tracked LCM Items for PO ${poId} have inconsistent PO exchange rates for Cost Category ${category.costCategoryText || categoryKey}.`
          );
          return;
        }
        const poExchangeRate = toNumber(exchangeRates[0]) || 1;
        const receiptAmount = roundCurrency(category.baseAmount / poExchangeRate);
        landedCosts.push({
          costCategory: category.costCategory,
          costCategoryText: category.costCategoryText,
          baseAmount: roundCurrency(category.baseAmount),
          amount: receiptAmount,
        });
        baseAmount += category.baseAmount;
      });
      result.byPurchaseOrder[poId] = {
        landedCosts,
        baseAmount: roundCurrency(baseAmount),
      };
    });

    return result;
  }

  function inspectItemReceiptInventoryDetails(group) {
    const receipt = transformItemReceipt(group);
    const receivedLines = configureItemReceiptLines(receipt, group);
    return receivedLines
      .map((entry) => getItemReceiptInventoryDetailRequirement(receipt, entry))
      .filter(Boolean);
  }

  function transformItemReceipt(group) {
    return record.transform({
      fromType: record.Type.PURCHASE_ORDER,
      fromId: group.purchaseOrderId,
      toType: record.Type.ITEM_RECEIPT,
      isDynamic: false,
    });
  }

  function configureItemReceiptLines(receipt, group) {
    const poLinesByKey = loadPurchaseOrderLineIndex(group.purchaseOrderId);
    const receiptLineCount = getLineCount(receipt, 'item');
    const usedReceiptLines = {};

    for (let line = 0; line < receiptLineCount; line += 1) {
      receipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line, value: false });
    }

    return (group.rows || []).map((row) => {
      const sourceLineKey = extractPoLineUniqueKey(group.purchaseOrderId, row.poLineKey);
      const sourceLine = sourceLineKey ? poLinesByKey[sourceLineKey] : null;
      if (!sourceLine) {
        throw new Error(
          `LCM Item ${row.id} cannot be matched to a current line on PO ${group.purchaseOrderText}. Its PO Line Key is "${row.poLineKey || '(blank)'}".`
        );
      }
      const receiptLine = findTransformedItemReceiptLine(receipt, sourceLine);
      if (receiptLine < 0) {
        throw new Error(
          `LCM Item ${row.id} could not find PO line ${sourceLineKey} on the transformed Item Receipt for ${group.purchaseOrderText}.`
        );
      }
      if (usedReceiptLines[receiptLine]) {
        throw new Error(`More than one LCM Item row resolves to Item Receipt line ${receiptLine + 1} for PO ${group.purchaseOrderText}.`);
      }
      usedReceiptLines[receiptLine] = true;
      receipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: receiptLine, value: true });
      receipt.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: receiptLine, value: row.quantity });

      const appliedQuantity = toNumber(getSublistValue(receipt, 'item', 'quantity', receiptLine));
      if (
        !isChecked(getSublistValue(receipt, 'item', 'itemreceive', receiptLine)) ||
        appliedQuantity === null ||
        Math.abs(appliedQuantity - row.quantity) > 0.000001
      ) {
        throw new Error(`LCM Item ${row.id} could not set its receive quantity on the transformed Item Receipt.`);
      }
      return { row, receiptLine };
    });
  }

  function getItemReceiptInventoryDetailRequirement(receipt, entry) {
    if (!isChecked(getSublistValue(receipt, 'item', 'inventorydetailreq', entry.receiptLine))) return null;

    const flags = getItemInventoryDetailFlags(entry.row.itemId);
    const inventoryDetail = inspectInventoryAssignmentDetails(receipt, entry.receiptLine);
    const mandatoryFields = inventoryDetail.mandatoryFields;
    const kind = flags.isSerial ? 'Serial Number' : flags.isLot ? 'Lot Number' : flags.useBins ? 'Bin' : 'Inventory Detail';
    return {
      lcmItemId: String(entry.row.id),
      purchaseOrderId: String(entry.row.purchaseOrderId),
      purchaseOrderText: entry.row.purchaseOrderText || entry.row.purchaseOrderId,
      itemId: String(entry.row.itemId),
      itemText: entry.row.itemText || entry.row.itemId,
      requiredQuantity: entry.row.quantity,
      receiptLine: entry.receiptLine + 1,
      locationId: normalizeValue(getSublistValue(receipt, 'item', 'location', entry.receiptLine)).trim(),
      locationText: normalizeValue(getSublistText(receipt, 'item', 'location', entry.receiptLine)).trim(),
      kind,
      requiresReceiptInventoryNumber: flags.isSerial || flags.isLot || mandatoryFields.receiptInventoryNumber,
      requiresBin: flags.useBins || mandatoryFields.binNumber,
      requiresInventoryStatus: mandatoryFields.inventoryStatus,
      requiresExpirationDate: mandatoryFields.expirationDate,
      sourcedBinNumber: inventoryDetail.sourcedBinNumber,
      sourcedInventoryStatus: inventoryDetail.sourcedInventoryStatus,
      isSerial: flags.isSerial,
    };
  }

  function inspectInventoryAssignmentDetails(receipt, receiptLine) {
    const details = {
      mandatoryFields: {
        receiptInventoryNumber: false,
        binNumber: false,
        inventoryStatus: false,
        expirationDate: false,
      },
      sourcedBinNumber: '',
      sourcedInventoryStatus: '',
    };
    const detail = getSublistSubrecord(receipt, 'item', 'inventorydetail', receiptLine);
    if (!detail) return details;

    let insertedLine = false;
    try {
      if (!getLineCount(detail, 'inventoryassignment')) {
        detail.insertLine({ sublistId: 'inventoryassignment', line: 0 });
        insertedLine = true;
      }
      const fieldIds = {
        receiptInventoryNumber: 'receiptinventorynumber',
        binNumber: 'binnumber',
        inventoryStatus: 'inventorystatus',
        expirationDate: 'expirationdate',
      };
      Object.keys(fieldIds).forEach((key) => {
        const field = getSublistField(detail, 'inventoryassignment', fieldIds[key], 0);
        details.mandatoryFields[key] = Boolean(field && field.isMandatory);
      });
      // NetSuite can source a location's receiving Bin and Inventory Status on the transformed
      // receipt. Preserve those values when replacing the assignment with LCM's automatic lot.
      details.sourcedBinNumber = normalizeValue(getSublistValue(detail, 'inventoryassignment', 'binnumber', 0)).trim();
      details.sourcedInventoryStatus = normalizeValue(
        getSublistValue(detail, 'inventoryassignment', 'inventorystatus', 0)
      ).trim();
    } catch (error) {
      // The transformed line remains authoritative for Inventory Detail itself.
      // Item flags still cover lot, serial, and bin requirements when metadata is unavailable.
    } finally {
      if (insertedLine) {
        try {
          detail.removeLine({ sublistId: 'inventoryassignment', line: 0, ignoreRecalc: true });
        } catch (error) {
          // This preview-only transformed record is discarded after inspection.
        }
      }
    }
    return details;
  }

  function getItemInventoryDetailFlags(itemId) {
    const key = normalizeValue(itemId).trim();
    if (!key) return { isSerial: false, isLot: false, useBins: false };
    if (inventoryDetailFlagsCache[key]) return inventoryDetailFlagsCache[key];

    const fields = ['isserialitem', 'islotitem', 'usebins'];
    const flags = { isSerial: false, isLot: false, useBins: false };
    try {
      const values = search.lookupFields({ type: 'item', id: key, columns: fields });
      flags.isSerial = isChecked(values.isserialitem);
      flags.isLot = isChecked(values.islotitem);
      flags.useBins = isChecked(values.usebins);
    } catch (error) {
      // Some item types do not expose every flag. Read each available field independently.
      fields.forEach((fieldId) => {
        try {
          const values = search.lookupFields({ type: 'item', id: key, columns: [fieldId] });
          if (fieldId === 'isserialitem') flags.isSerial = isChecked(values[fieldId]);
          if (fieldId === 'islotitem') flags.isLot = isChecked(values[fieldId]);
          if (fieldId === 'usebins') flags.useBins = isChecked(values[fieldId]);
        } catch (fieldError) {
          // The transformed Item Receipt remains authoritative for whether detail is required.
        }
      });
    }
    inventoryDetailFlagsCache[key] = flags;
    return flags;
  }

  function prepareItemReceipt(group, parentId, shipmentNumber) {
    const receipt = transformItemReceipt(group);
    const receivedLines = configureItemReceiptLines(receipt, group);
    applyItemReceiptInventoryDetails(receipt, receivedLines, shipmentNumber, group.purchaseOrderText);

    const sourceKey = buildItemReceiptSourceKey(parentId, group.purchaseOrderId);
    setRequiredItemReceiptSourceKey(receipt, sourceKey, group.purchaseOrderText);
    appendItemReceiptMemo(receipt, parentId, group.purchaseOrderText);
    applyItemReceiptLandedCosts(receipt, group);

    return {
      group,
      save() {
        const id = receipt.save({ enableSourcing: true, ignoreMandatoryFields: false });
        return makeTransactionResult('Item Receipt', record.Type.ITEM_RECEIPT, id, 'Created');
      },
    };
  }

  function applyItemReceiptInventoryDetails(receipt, receivedLines, shipmentNumber, purchaseOrderText) {
    const requirementsByLcmItem = {};
    (receivedLines || []).forEach((entry) => {
      const requirement = getItemReceiptInventoryDetailRequirement(receipt, entry);
      if (requirement) requirementsByLcmItem[requirement.lcmItemId] = requirement;
    });
    (receivedLines || []).forEach((entry) => {
      const requirement = requirementsByLcmItem[String(entry.row.id)];
      if (!requirement) return;

      const assignment = buildAutomaticInventoryAssignment(requirement, shipmentNumber);
      validateInventoryAssignments(requirement, [assignment], purchaseOrderText);
      const detail = getSublistSubrecord(receipt, 'item', 'inventorydetail', entry.receiptLine);
      if (!detail) {
        throw new Error(
          `LCM Item ${requirement.lcmItemId} (${requirement.itemText}) requires Inventory Detail, but the transformed Item Receipt does not expose the Inventory Detail subrecord.`
        );
      }

      clearInventoryAssignments(detail);
      detail.insertLine({ sublistId: 'inventoryassignment', line: 0 });
      setInventoryAssignmentValue(detail, 'binnumber', assignment.binNumber, requirement, 0, requirement.requiresBin);
      setInventoryAssignmentValue(
        detail,
        'inventorystatus',
        assignment.inventoryStatus,
        requirement,
        0,
        requirement.requiresInventoryStatus
      );
      setInventoryAssignmentValue(
        detail,
        'receiptinventorynumber',
        assignment.receiptInventoryNumber,
        requirement,
        0,
        requirement.requiresReceiptInventoryNumber
      );
      setInventoryAssignmentValue(
        detail,
        'expirationdate',
        assignment.expirationDate,
        requirement,
        0,
        requirement.requiresExpirationDate
      );
      setInventoryAssignmentValue(detail, 'quantity', assignment.quantity, requirement, 0, true);
    });
  }

  function buildAutomaticInventoryAssignment(requirement, shipmentNumber) {
    const errors = getInventoryDetailAutomationErrors(requirement);
    if (errors.length) throw new Error(errors.join('\n'));
    return {
      receiptInventoryNumber: requirement.requiresReceiptInventoryNumber
        ? buildAutomaticReceiptInventoryNumber(shipmentNumber, requirement)
        : '',
      binNumber: getAutomaticInventoryDetailValue('sourcedBinNumber', 'receivingBinByLocation', requirement),
      inventoryStatus: getAutomaticInventoryDetailValue(
        'sourcedInventoryStatus',
        'receivingInventoryStatusByLocation',
        requirement
      ),
      expirationDate: '',
      quantity: requirement.requiredQuantity,
    };
  }

  function getInventoryDetailAutomationErrors(requirement) {
    const itemLabel = `LCM Item ${requirement.lcmItemId} (${requirement.itemText})`;
    if (requirement.isSerial) {
      return [`${itemLabel} is serialized. Create Item Receipt will not invent physical serial numbers.`];
    }
    if (requirement.requiresExpirationDate) {
      return [`${itemLabel} requires an Expiration Date. Automatic Item Receipt cannot invent supplier expiry data.`];
    }
    const errors = [];
    if (requirement.requiresBin && !getAutomaticInventoryDetailValue('sourcedBinNumber', 'receivingBinByLocation', requirement)) {
      errors.push(`${itemLabel} requires a Bin Number, but NetSuite did not source one and no receiving bin is configured for ${inventoryDetailLocationText(requirement)}.`);
    }
    if (
      requirement.requiresInventoryStatus &&
      !getAutomaticInventoryDetailValue('sourcedInventoryStatus', 'receivingInventoryStatusByLocation', requirement)
    ) {
      errors.push(`${itemLabel} requires an Inventory Status, but NetSuite did not source one and no receiving status is configured for ${inventoryDetailLocationText(requirement)}.`);
    }
    return errors;
  }

  function getAutomaticInventoryDetailValue(sourcedField, configuredType, requirement) {
    const sourcedValue = normalizeValue(requirement[sourcedField]).trim();
    if (sourcedValue) return sourcedValue;
    if (configuredType === 'receivingInventoryStatusByLocation') {
      const defaultStatus = getDefaultInventoryStatusId();
      if (defaultStatus) return defaultStatus;
    }
    return getConfiguredReceivingInventoryDetailValue(configuredType, requirement);
  }

  function getDefaultInventoryStatusId() {
    const cacheKey = 'default';
    if (Object.prototype.hasOwnProperty.call(defaultInventoryStatusCache, cacheKey)) {
      return defaultInventoryStatusCache[cacheKey];
    }

    let defaultStatusId = '';
    try {
      const defaultStatus = search
        .create({
          type: 'inventorystatus',
          filters: [
            ['isinactive', 'is', 'F'],
            'AND',
            ['isdefault', 'is', 'T'],
          ],
          columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })],
        })
        .run()
        .getRange({ start: 0, end: 1 });
      if (defaultStatus && defaultStatus.length) {
        defaultStatusId = normalizeValue(defaultStatus[0].getValue({ name: 'internalid' })).trim();
      }
    } catch (error) {
      // Some account forms do not expose isdefault to N/search. The standard default Inventory
      // Status is the earliest active status, and custom statuses are created after it.
      try {
        const activeStatuses = search
          .create({
            type: 'inventorystatus',
            filters: [['isinactive', 'is', 'F']],
            columns: [search.createColumn({ name: 'internalid', sort: search.Sort.ASC })],
          })
          .run()
          .getRange({ start: 0, end: 1 });
        if (activeStatuses && activeStatuses.length) {
          defaultStatusId = normalizeValue(activeStatuses[0].getValue({ name: 'internalid' })).trim();
        }
      } catch (fallbackError) {
        // The optional per-location configuration remains available when account lookup is unavailable.
      }
    }
    defaultInventoryStatusCache[cacheKey] = defaultStatusId;
    return defaultStatusId;
  }

  function getConfiguredReceivingInventoryDetailValue(type, requirement) {
    const itemReceiptDefaults = DEFAULTS.itemReceipt || {};
    const values = itemReceiptDefaults[type] || {};
    return normalizeValue(values[requirement.locationId] || values.default).trim();
  }

  function inventoryDetailLocationText(requirement) {
    return requirement.locationText || (requirement.locationId ? `Location ${requirement.locationId}` : 'the receipt location');
  }

  function buildAutomaticReceiptInventoryNumber(shipmentNumber, requirement) {
    const shipmentPart = normalizeValue(shipmentNumber).trim() || `LCM-${requirement.lcmItemId}`;
    const itemPart = normalizeValue(requirement.itemText).trim() || `ITEM-${requirement.itemId}`;
    return `${shipmentPart}-${itemPart}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }

  function validateInventoryAssignments(requirement, assignments, purchaseOrderText) {
    const itemLabel = `LCM Item ${requirement.lcmItemId} (${requirement.itemText}) on PO ${purchaseOrderText}`;
    if (!assignments.length) {
      throw new Error(
        `${itemLabel} requires ${requirement.kind} Inventory Detail. Add assignment rows in the Item Receipt preview before confirming.`
      );
    }

    const assignedQuantity = assignments.reduce((total, assignment) => total + (toNumber(assignment.quantity) || 0), 0);
    if (Math.abs(assignedQuantity - requirement.requiredQuantity) > 0.000001) {
      throw new Error(
        `${itemLabel} has Inventory Detail quantity ${assignedQuantity}, but its Quantity Receipt is ${requirement.requiredQuantity}. The assignment total must match exactly.`
      );
    }
    if (assignments.some((assignment) => !toNumber(assignment.quantity) || toNumber(assignment.quantity) <= 0)) {
      throw new Error(`${itemLabel} has an Inventory Detail assignment with a missing or non-positive quantity.`);
    }
    if (requirement.requiresReceiptInventoryNumber && assignments.some((assignment) => !normalizeValue(assignment.receiptInventoryNumber).trim())) {
      throw new Error(`${itemLabel} requires a Receipt Inventory Number for every Inventory Detail assignment.`);
    }
    if (requirement.requiresBin && assignments.some((assignment) => !normalizeValue(assignment.binNumber).trim())) {
      throw new Error(`${itemLabel} requires a Bin Number for every Inventory Detail assignment.`);
    }
    if (requirement.requiresInventoryStatus && assignments.some((assignment) => !normalizeValue(assignment.inventoryStatus).trim())) {
      throw new Error(`${itemLabel} requires an Inventory Status for every Inventory Detail assignment.`);
    }
    if (requirement.requiresExpirationDate && assignments.some((assignment) => !normalizeValue(assignment.expirationDate).trim())) {
      throw new Error(`${itemLabel} requires an Expiration Date for every Inventory Detail assignment.`);
    }
    if (requirement.isSerial && assignments.some((assignment) => Math.abs((toNumber(assignment.quantity) || 0) - 1) > 0.000001)) {
      throw new Error(`${itemLabel} is serialized. Enter one assignment per serial number with Quantity 1.`);
    }
    if (requirement.isSerial) {
      const serials = assignments.map((assignment) => normalizeValue(assignment.receiptInventoryNumber).trim());
      if (uniqueIds(serials).length !== serials.length) {
        throw new Error(`${itemLabel} has duplicate serial numbers in its Inventory Detail assignments.`);
      }
    }
  }

  function clearInventoryAssignments(detail) {
    for (let line = getLineCount(detail, 'inventoryassignment') - 1; line >= 0; line -= 1) {
      detail.removeLine({ sublistId: 'inventoryassignment', line, ignoreRecalc: true });
    }
  }

  function setInventoryAssignmentValue(detail, fieldId, value, requirement, line, required) {
    const normalized = normalizeValue(value).trim();
    if (!normalized && !required) return;
    if (!normalized && required) {
      throw new Error(`LCM Item ${requirement.lcmItemId} is missing required Inventory Detail ${fieldId} on assignment ${line + 1}.`);
    }
    try {
      detail.setSublistValue({
        sublistId: 'inventoryassignment',
        fieldId,
        line,
        value: fieldId === 'expirationdate' ? toDateObject(value) : value,
      });
    } catch (error) {
      throw new Error(
        `LCM Item ${requirement.lcmItemId} could not set Inventory Detail ${fieldId} on assignment ${line + 1}: ${
          error.message || error
        }`
      );
    }
  }

  function getSublistSubrecord(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistSubrecord({ sublistId, fieldId, line });
    } catch (error) {
      return null;
    }
  }

  function getSublistField(rec, sublistId, fieldId, line) {
    try {
      return rec.getSublistField({ sublistId, fieldId, line });
    } catch (error) {
      return null;
    }
  }

  function loadPurchaseOrderLineIndex(purchaseOrderId) {
    const po = record.load({ type: record.Type.PURCHASE_ORDER, id: purchaseOrderId, isDynamic: false });
    const linesByKey = {};
    const count = getLineCount(po, 'item');
    for (let line = 0; line < count; line += 1) {
      const lineUniqueKey = normalizeValue(getSublistValue(po, 'item', 'lineuniquekey', line)).trim();
      if (!lineUniqueKey) continue;
      const lineNumber = normalizeValue(getSublistValue(po, 'item', 'line', line)).trim();
      linesByKey[lineUniqueKey] = {
        lineUniqueKey,
        itemId: normalizeValue(getSublistValue(po, 'item', 'item', line)).trim(),
        orderLineCandidates: uniqueIds([lineNumber, String(line + 1), lineUniqueKey]),
      };
    }
    return linesByKey;
  }

  function extractPoLineUniqueKey(purchaseOrderId, poLineKey) {
    const prefix = `${purchaseOrderId}:`;
    const value = normalizeValue(poLineKey).trim();
    if (!value || value.indexOf(prefix) !== 0) return '';
    const key = value.slice(prefix.length);
    return key.indexOf('line:') === 0 ? '' : key;
  }

  function findTransformedItemReceiptLine(receipt, sourceLine) {
    const candidates = sourceLine.orderLineCandidates || [];
    const count = getLineCount(receipt, 'item');
    for (let line = 0; line < count; line += 1) {
      const orderLine = normalizeValue(getSublistValue(receipt, 'item', 'orderline', line)).trim();
      const lineUniqueKey = normalizeValue(getSublistValue(receipt, 'item', 'lineuniquekey', line)).trim();
      if (candidates.indexOf(orderLine) >= 0 || (lineUniqueKey && lineUniqueKey === sourceLine.lineUniqueKey)) return line;
    }
    return -1;
  }

  function buildItemReceiptSourceKey(parentId, purchaseOrderId) {
    return `LCM${parentId}::PO${purchaseOrderId}`;
  }

  function setRequiredItemReceiptSourceKey(receipt, sourceKey, purchaseOrderText) {
    const fieldId = TRANSACTION_FIELDS.itemReceipt.sourceKey;
    try {
      receipt.setValue({ fieldId, value: sourceKey });
      if (normalizeValue(getRecordValue(receipt, fieldId)) !== sourceKey) {
        throw new Error('the value was not retained by the Item Receipt form');
      }
    } catch (error) {
      throw new Error(
        `Item Receipt for PO ${purchaseOrderText} could not be marked with ${fieldId}. Deploy the LCM Item Receipt Source Key field before creating receipts. ${
          error.message || error
        }`
      );
    }
  }

  function appendItemReceiptMemo(receipt, parentId, purchaseOrderText) {
    const marker = `LCM ${parentId} / ${purchaseOrderText}`;
    const existingMemo = normalizeValue(getRecordValue(receipt, 'memo')).trim();
    if (existingMemo.indexOf(marker) >= 0) return;
    receipt.setValue({ fieldId: 'memo', value: [existingMemo, marker].filter(Boolean).join(' | ') });
  }

  function applyItemReceiptLandedCosts(receipt, group) {
    const landedCosts = (group.landedCosts || []).filter((entry) => (entry.amount || 0) !== 0);
    if (!landedCosts.length) return;
    if (!setItemReceiptLandedCostMethod(receipt, group.allocationMethodText)) {
      throw new Error(
        `Item Receipt for PO ${group.purchaseOrderText} does not expose the Landed Cost Allocation Method field.`
      );
    }

    landedCosts.forEach((entry) => {
      if (!setItemReceiptLandedCostSourceManual(receipt, entry) || !setItemReceiptLandedCostAmount(receipt, entry, entry.amount)) {
        throw new Error(
          `Item Receipt for PO ${group.purchaseOrderText} could not apply Manual landed cost for category ${
            entry.costCategoryText || entry.costCategory
          }. Verify that the Landed Cost feature, category, and Item Receipt form are enabled.`
        );
      }
    });
  }

  function setItemReceiptLandedCostMethod(receipt, allocationMethodText) {
    const methodText = getVendorBillLandedCostMethodText(allocationMethodText);
    const fieldIds = [TRANSACTION_FIELDS.itemReceipt.landedCostMethod, 'landedCostMethod'];
    const values = getVendorBillLandedCostMethodValues(methodText);
    for (let index = 0; index < fieldIds.length; index += 1) {
      const fieldId = fieldIds[index];
      try {
        receipt.setText({ fieldId, text: methodText });
      } catch (textError) {
        for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
          try {
            receipt.setValue({ fieldId, value: values[valueIndex] });
            break;
          } catch (valueError) {
            // Try the next NetSuite representation.
          }
        }
      }
      const applied = normalizeChoice(getRecordText(receipt, fieldId) || getRecordValue(receipt, fieldId));
      if (applied === normalizeChoice(methodText)) return true;
    }
    return false;
  }

  function setItemReceiptLandedCostSourceManual(receipt, costCategory) {
    const fieldIds = getTransactionLandedCostFieldIds(receipt, 'source', costCategory);
    const values = ['MANUAL', 'Manual', 'manual'];
    for (let fieldIndex = 0; fieldIndex < fieldIds.length; fieldIndex += 1) {
      const fieldId = fieldIds[fieldIndex];
      try {
        receipt.setText({ fieldId, text: 'Manual' });
      } catch (textError) {
        for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
          try {
            receipt.setValue({ fieldId, value: values[valueIndex] });
            break;
          } catch (valueError) {
            // Try the next source value representation.
          }
        }
      }
      const applied = normalizeChoice(getRecordText(receipt, fieldId) || getRecordValue(receipt, fieldId));
      if (applied === 'manual') return true;
    }
    return false;
  }

  function setItemReceiptLandedCostAmount(receipt, costCategory, amount) {
    const expectedAmount = roundCurrency(amount);
    const fieldIds = getTransactionLandedCostFieldIds(receipt, 'amount', costCategory);
    for (let fieldIndex = 0; fieldIndex < fieldIds.length; fieldIndex += 1) {
      const fieldId = fieldIds[fieldIndex];
      try {
        receipt.setValue({ fieldId, value: expectedAmount });
      } catch (error) {
        continue;
      }
      const appliedAmount = toNumber(getRecordValue(receipt, fieldId));
      if (appliedAmount !== null && Math.abs(appliedAmount - expectedAmount) < 0.005) return true;
    }
    return false;
  }

  function getTransactionLandedCostFieldIds(rec, kind, costCategory) {
    const resolvedSuffix = findLandedCostFieldSuffixByLabel(rec, costCategory.costCategoryText);
    const suffix = resolvedSuffix || String(costCategory.costCategory || '');
    const prefix = kind === 'source' ? 'landedcostsource' : 'landedcostamount';
    const fieldIds = suffix ? [`${prefix}${suffix}`, `${prefix}_${suffix}`] : [];
    return fieldIds.filter((fieldId, index) => fieldId && fieldIds.indexOf(fieldId) === index);
  }

  function findGeneratedItemReceipt(parentId, purchaseOrderId) {
    const sourceKey = buildItemReceiptSourceKey(parentId, purchaseOrderId);
    const matches = [];
    search
      .create({
        type: search.Type.ITEM_RECEIPT,
        filters: [[TRANSACTION_FIELDS.itemReceipt.sourceKey, 'is', sourceKey]],
        columns: ['internalid', 'tranid'],
      })
      .run()
      .each((result) => {
        matches.push({
          id: getValue(result, 'internalid'),
          tranid: getValue(result, 'tranid'),
        });
        return true;
      });
    if (matches.length > 1) {
      throw new Error(`Multiple Item Receipts use LCM source key ${sourceKey}. Resolve the duplicate markers before rerunning.`);
    }
    return matches[0] || null;
  }

  function linkLcmItemsToItemReceipt(rows, itemReceiptId) {
    (rows || []).forEach((row) => {
      record.submitFields({
        type: RECORDS.lcmItems,
        id: row.id,
        values: { [FIELDS.lcmItems.itemReceipt]: String(itemReceiptId) },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    });
  }

  function finalizeCostAllocationAfterReceipts(parentId, rows, existingReceiptItems) {
    const receiptItems = existingReceiptItems || fetchLcmReceiptItems(parentId);
    if (!receiptItems.length || receiptItems.some((row) => !row.itemReceiptId)) {
      return { complete: false, allocatedRowCount: 0 };
    }
    const costRows = (rows || []).filter((row) => row.targetMode === MODES.bill);
    if (!costRows.length) return { complete: false, allocatedRowCount: 0 };

    // The caller has already refreshed the LCM Item values. Only mark the cost rows after
    // every positive-quantity item row is linked to its receipt.
    markCostRowsAllocated(costRows, collectItemReceiptNumbers(receiptItems));
    return { complete: true, allocatedRowCount: costRows.length };
  }

  function collectItemReceiptNumbers(items) {
    return uniqueIds(
      (items || []).map((row) => row.itemReceiptText || row.itemReceiptId).filter(Boolean)
    );
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
        },
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    });
  }

  function markCostRowsAllocated(rows, grnNumbers) {
    const f = FIELDS.lcmLandedCosts;
    const grnNumber = formatGrnNumberList(grnNumbers);
    rows.forEach((row) => {
      const values = {
        [f.costAllocatedInGrn]: true,
      };
      if (grnNumber) values[f.grnNumber] = grnNumber;
      record.submitFields({
        type: RECORDS.lcmLandedCosts,
        id: row.id,
        values,
        options: { enableSourcing: true, ignoreMandatoryFields: true },
      });
    });
  }

  function formatGrnNumberList(numbers) {
    const value = uniqueIds(numbers || []).join(', ');
    return value.length <= 300 ? value : `${value.slice(0, 297)}...`;
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
    buildItemReceiptPreview,
    createTransactions,
    createItemReceipts,
    fetchLandedCostRows,
    getAllocationMethodDefault,
    getCostItemMapDefaults,
    getVendorBillDefaults,
    getVendorCurrencyDefaults,
    getVendorDefaults,
    listCostCategoryItemMatches,
    normalizeMode,
    recalculateAllocatedCosts,
  };
});
