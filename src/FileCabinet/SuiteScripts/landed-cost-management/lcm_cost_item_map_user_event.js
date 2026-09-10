/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/search', './lcm_po_selection_config'], (error, search, config) => {
  const { FIELDS, RECORDS } = config;

  function beforeSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;

    const rec = context.newRecord;
    const f = FIELDS.lcmCostItemMap;
    const costCategoryId = normalizeValue(rec.getValue({ fieldId: f.costCategory }));
    const costCategoryText = normalizeValue(getText(rec, f.costCategory));
    const costItemId = normalizeValue(rec.getValue({ fieldId: f.costItem }));
    const costItemText = normalizeValue(getText(rec, f.costItem));

    setMappingName(rec, costCategoryText, costCategoryId);

    if (!costCategoryId) {
      throw error.create({
        name: 'LCM_COST_MAP_CATEGORY_REQUIRED',
        message: 'LC Cost Category is required.',
        notifyOff: false,
      });
    }

    if (!costItemId) {
      throw error.create({
        name: 'LCM_COST_MAP_ITEM_REQUIRED',
        message: 'LC Cost Item is required.',
        notifyOff: false,
      });
    }

    const inactive = isInactive(rec);
    if (!inactive && !isActiveItem(costItemId)) {
      throw error.create({
        name: 'LCM_COST_MAP_ITEM_INACTIVE',
        message: `LC Cost Item "${costItemText || costItemId}" is inactive or cannot be found.`,
        notifyOff: false,
      });
    }

    if (!inactive && hasDuplicateActiveCategory(costCategoryId, rec.id)) {
      throw error.create({
        name: 'LCM_COST_MAP_DUPLICATE_CATEGORY',
        message: `An active LCM Cost Category Item Map already exists for "${costCategoryText || costCategoryId}". Inactivate the old mapping before creating another.`,
        notifyOff: false,
      });
    }
  }

  function setMappingName(rec, costCategoryText, costCategoryId) {
    const name = normalizeValue(costCategoryText || costCategoryId).slice(0, 300);
    if (!name) return;
    try {
      rec.setValue({ fieldId: 'name', value: name });
    } catch (setNameError) {
      // The name field exists only when the custom record type includes Name.
    }
  }

  function hasDuplicateActiveCategory(costCategoryId, currentRecordId) {
    const f = FIELDS.lcmCostItemMap;
    const filters = [['isinactive', 'is', 'F'], 'AND', [f.costCategory, 'anyof', costCategoryId]];
    if (currentRecordId) {
      filters.push('AND', ['internalid', 'noneof', String(currentRecordId)]);
    }

    const results = search
      .create({
        type: RECORDS.lcmCostItemMap,
        filters,
        columns: ['internalid'],
      })
      .run()
      .getRange({ start: 0, end: 1 });

    return Boolean(results && results.length);
  }

  function isActiveItem(itemId) {
    const results = search
      .create({
        type: 'item',
        filters: [['isinactive', 'is', 'F'], 'AND', ['internalid', 'anyof', itemId]],
        columns: ['internalid'],
      })
      .run()
      .getRange({ start: 0, end: 1 });

    return Boolean(results && results.length);
  }

  function isInactive(rec) {
    const value = rec.getValue({ fieldId: 'isinactive' });
    return value === true || value === 'T';
  }

  function getText(rec, fieldId) {
    try {
      return rec.getText({ fieldId }) || '';
    } catch (getTextError) {
      return '';
    }
  }

  function normalizeValue(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  return { beforeSubmit };
});
