/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/format', 'N/log', 'N/record', './lcm_po_selection_config', './lcm_accounting_lib'], (
  error,
  format,
  log,
  record,
  config,
  accounting
) => {
  const { FIELDS, RECORDS } = config;

  function beforeLoad(context) {
    if (!context.form) return;
    context.form.clientScriptModulePath = './lcm_po_selection_client.js';
    logFormFieldInventory(context);
  }

  // Answers "which field id is the visible LC Cost Item on the form actually being rendered?".
  // A custom entry form keeps its own layout and overrides the displaytype held in SDF, so the
  // object XML cannot be trusted to describe the live form. This reads the rendered form itself.
  // Runs server side, so it lands in the script execution log for customscript_lcm_landed_cost_lock_ue.
  function logFormFieldInventory(context) {
    if (!config.DEBUG.logFormFields) return;

    let fieldIds = [];
    try {
      fieldIds = context.newRecord.getFields() || [];
    } catch (fieldsError) {
      log.error({ title: 'LCM form field inventory unavailable', details: fieldsError.message || fieldsError });
      return;
    }

    const onForm = [];
    const notOnForm = [];
    fieldIds.forEach((fieldId) => {
      if (String(fieldId).indexOf('custrecord') !== 0) return;
      try {
        const field = context.form.getField({ id: fieldId });
        onForm.push(`${fieldId} = "${(field && field.label) || ''}" [${(field && field.type) || '?'}]`);
      } catch (getFieldError) {
        notOnForm.push(fieldId);
      }
    });

    log.audit({
      title: 'LCM Landed Cost form field inventory',
      details:
        `Form: ${getFormIdentity(context)}. ` +
        `Configured LC Cost Profile: ${FIELDS.lcmLandedCosts.costProfile}. ` +
        `Configured LC Cost Item: ${FIELDS.lcmLandedCosts.billItem}. ` +
        `ON FORM -> ${onForm.join(' | ') || 'none'}. ` +
        `NOT ON FORM -> ${notOnForm.join(', ') || 'none'}`,
    });
  }

  function getFormIdentity(context) {
    try {
      const customForm = context.newRecord.getValue({ fieldId: 'customform' });
      return `${context.type} customform=${customForm || '(default)'}`;
    } catch (error) {
      return String(context.type || 'unknown');
    }
  }

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
      if (context.type === context.UserEventType.XEDIT) {
        // An inline edit submits only the touched fields, so the full vendor/parent sourcing has
        // nothing to read. The cost profile refs are self-contained and safe to derive here.
        sourceCostProfileRefs(context.newRecord);
      } else {
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

  // Server-side sourcing is the guaranteed path: it runs no matter which form was used, whether
  // the fields are hidden, and whether the client script loaded at all. The client script only
  // mirrors this so the user sees the value before saving.
  function sourceCostProfileRefs(rec) {
    const f = FIELDS.lcmLandedCosts;
    const selectedCategory = getSelectedCostCategory(rec);
    const profileId = selectedCategory.value;
    const profileText = selectedCategory.text;

    if (!profileId && !profileText) {
      log.audit({
        title: 'LCM LC Cost Profile sourcing skipped',
        details: `No value on ${getCostProfileSourceFieldIds().join(' or ')}. Nothing to resolve an LC Cost Item from.`,
      });
      return;
    }

    const defaults = accounting.getCostProfileDefaults(profileId, profileText);
    if (!defaults.costCategory && !defaults.costCategoryText) return;

    const categorySet =
      selectedCategory.fieldId === f.costCategory ||
      setValueOrText(rec, f.costCategory, defaults.costCategory, defaults.costCategoryText);
    const itemSet = setValueOrText(rec, f.billItem, defaults.billItem, defaults.billItemText);

    if (!itemSet) {
      log.error({
        title: 'LCM LC Cost Item was not written to the record',
        details:
          `Source field: ${selectedCategory.fieldId || '(none)'}. ` +
          `Cost Profile internal id: ${profileId || '(none)'}. Cost Profile text: "${profileText ||
            defaults.costCategoryText}". Attempted item name: "${defaults.attemptedItemName || ''}". ` +
          `Resolved item: ${defaults.billItem || '(none)'}. Target field: ${f.billItem}. ` +
          `Reason: ${
            defaults.billItem
              ? `field ${f.billItem} rejected the write or does not exist on this record. Check the LCM Landed Cost form field inventory log for the real field id.`
              : defaults.reason || 'no matching item'
          }`,
      });
      return;
    }

    log.audit({
      title: 'LCM LC Cost Item sourced',
      details: `${selectedCategory.fieldId}=${profileId} ("${defaults.costCategoryText}") -> ${f.billItem}=${
        defaults.billItem
      } ("${defaults.billItemText}"). Cost Category written: ${categorySet}.`,
    });
  }

  function sourceAllocationMethodDefault(rec) {
    const f = FIELDS.lcmLandedCosts;
    if (rec.getValue({ fieldId: f.allocationMethod })) return;

    const costCategoryId = getValueIfPresent(rec, f.costCategory) || getValueIfPresent(rec, f.costProfile);
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
        return true;
      } catch (valueError) {
        // Fall through to text sourcing where available.
      }
    }

    if (!text) return false;

    try {
      rec.setText({ fieldId, text });
      return true;
    } catch (textError) {
      // Keep save flow moving if an account-specific default cannot be applied.
      return false;
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

  function getCostProfileSourceFieldIds() {
    const f = FIELDS.lcmLandedCosts;
    return [f.costProfile, f.costCategory].filter((fieldId, index, fieldIds) => fieldId && fieldIds.indexOf(fieldId) === index);
  }

  function getSelectedCostCategory(rec) {
    const fieldIds = getCostProfileSourceFieldIds();
    for (let index = 0; index < fieldIds.length; index += 1) {
      const fieldId = fieldIds[index];
      const value = getValueIfPresent(rec, fieldId);
      const text = getTextIfPresent(rec, fieldId);
      if (value || text) return { fieldId, value, text };
    }
    return { fieldId: '', value: '', text: '' };
  }

  function getValueIfPresent(rec, fieldId) {
    try {
      return rec.getValue({ fieldId }) || '';
    } catch (error) {
      return '';
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

  return { beforeLoad, beforeSubmit };
});
