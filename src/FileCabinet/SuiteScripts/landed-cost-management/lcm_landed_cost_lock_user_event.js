/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/format', 'N/record', './lcm_po_selection_config', './lcm_accounting_lib'], (
  error,
  format,
  record,
  config,
  accounting
) => {
  const { FIELDS, RECORDS } = config;

  function beforeSubmit(context) {
    const f = FIELDS.lcmLandedCosts;
    if (context.type === context.UserEventType.DELETE) return;

    if (context.type === context.UserEventType.CREATE) {
      sourceVendorDefaults(context.newRecord);
      return;
    }
    if (!context.oldRecord) return;

    const oldStatus = context.oldRecord.getValue({ fieldId: f.processingStatus });
    const oldTranId = context.oldRecord.getValue({ fieldId: f.createdTransactionId });
    const wasCreated = normalize(oldStatus) === normalize(accounting.STATUS.created) || Boolean(oldTranId);
    if (!wasCreated) {
      if (context.type !== context.UserEventType.XEDIT) {
        sourceVendorDefaults(context.newRecord);
      }
      return;
    }

    const submittedFieldIds = getSubmittedFieldIds(context.newRecord);
    const changed = protectedFields().filter((fieldId) => {
      if (submittedFieldIds && !submittedFieldIds[fieldId]) return false;
      return normalizeValue(context.oldRecord.getValue({ fieldId })) !== normalizeValue(context.newRecord.getValue({ fieldId }));
    });

    if (changed.length) {
      throw error.create({
        name: 'LCM_ACCOUNTING_ROW_LOCKED',
        message: 'This Landed Cost row already created an accounting transaction. Reset/reversal is required before changing transaction-driving fields.',
        notifyOff: false,
      });
    }
  }

  function sourceVendorDefaults(rec) {
    const f = FIELDS.lcmLandedCosts;
    if (!rec.getValue({ fieldId: f.createdDate })) {
      rec.setText({ fieldId: f.createdDate, text: todayDateText() });
    }
    const parentDefaults = getParentDefaults(rec);
    setValueIfPresent(rec, f.vendor, parentDefaults.vendor);
    setValueIfPresent(rec, f.subsidiary, parentDefaults.subsidiary);
    sourceCostProfileRefs(rec);
    sourceAllocationMethodDefault(rec);

    const vendorId = rec.getValue({ fieldId: f.vendor });
    if (!vendorId) return;

    const defaults = accounting.getVendorBillDefaults(vendorId);
    setDefaultIfBlank(rec, f.subsidiary, defaults.subsidiary, defaults.subsidiaryText);
    setDefaultIfBlank(rec, f.currency, defaults.currency, defaults.currencyText);
    setDefaultIfBlank(rec, f.exchangeRate, defaults.exchangeRate);
    setDefaultIfBlank(rec, f.billType, defaults.billType, defaults.billTypeText);
    setDefaultIfBlank(rec, f.expenseAccount, defaults.expenseAccount, defaults.expenseAccountText);
  }

  function getParentDefaults(rec) {
    const parentId = rec.getValue({ fieldId: FIELDS.lcmLandedCosts.parent });
    if (!parentId) return {};

    try {
      const parent = record.load({
        type: RECORDS.landedCostManagement,
        id: parentId,
        isDynamic: false,
      });
      return {
        vendor: parent.getValue({ fieldId: FIELDS.landedCostManagement.vendor }),
        subsidiary: parent.getValue({ fieldId: FIELDS.landedCostManagement.subsidiary }),
      };
    } catch (loadError) {
      return {};
    }
  }

  function sourceCostProfileRefs(rec) {
    const f = FIELDS.lcmLandedCosts;
    const defaults = accounting.getCostProfileDefaults(
      rec.getValue({ fieldId: f.costProfile }),
      getTextIfPresent(rec, f.costProfile)
    );
    if (!defaults.costCategory && !defaults.costCategoryText) return;

    setValueOrText(rec, f.costCategory, defaults.costCategory, defaults.costCategoryText);
    setValueOrText(rec, f.billItem, defaults.billItem, defaults.billItemText);
  }

  function sourceAllocationMethodDefault(rec) {
    const f = FIELDS.lcmLandedCosts;
    if (rec.getValue({ fieldId: f.allocationMethod })) return;

    const costCategoryId = rec.getValue({ fieldId: f.costCategory });
    if (!costCategoryId) return;

    const defaults = accounting.getAllocationMethodDefault(costCategoryId);
    if (!defaults.allocationMethodText) return;

    try {
      rec.setText({ fieldId: f.allocationMethod, text: defaults.allocationMethodText });
    } catch (setTextError) {
      // Keep save flow moving if account-specific list text differs.
    }
  }

  function todayDateText() {
    return format.format({
      value: new Date(),
      type: format.Type.DATE,
    });
  }

  function protectedFields() {
    const f = FIELDS.lcmLandedCosts;
    return [
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
    ];
  }

  function normalize(value) {
    return String(value || '').toLowerCase();
  }

  function setDefaultIfBlank(rec, fieldId, value, text) {
    if (rec.getValue({ fieldId })) return;
    setValueOrText(rec, fieldId, value, text);
  }

  function setValueOrText(rec, fieldId, value, text) {
    if (value !== null && value !== undefined && value !== '') {
      try {
        rec.setValue({ fieldId, value });
        return;
      } catch (valueError) {
        // Fall through to text sourcing where available.
      }
    }

    if (!text) return;

    try {
      rec.setText({ fieldId, text });
    } catch (textError) {
      // Keep save flow moving if an account-specific default cannot be applied.
    }
  }

  function setValueIfPresent(rec, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    try {
      rec.setValue({ fieldId, value });
    } catch (error) {
      // Keep save flow moving if a hidden compatibility field is not exposed.
    }
  }

  function getTextIfPresent(rec, fieldId) {
    try {
      return rec.getText({ fieldId }) || '';
    } catch (error) {
      return '';
    }
  }

  function normalizeValue(value) {
    if (Array.isArray(value)) return value.map(String).sort().join(',');
    return String(value === null || value === undefined ? '' : value);
  }

  function getSubmittedFieldIds(rec) {
    try {
      const fieldIds = rec.getFields();
      if (!fieldIds || !fieldIds.length) return null;
      return fieldIds.reduce((map, fieldId) => {
        map[fieldId] = true;
        return map;
      }, {});
    } catch (fieldError) {
      return null;
    }
  }

  return { beforeSubmit };
});
