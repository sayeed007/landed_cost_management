/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(
  [
    'N/error',
    'N/log',
    'N/record',
    'N/ui/serverWidget',
    './lcm_po_selection_config',
    './lcm_accounting_lib',
    './lcm_shipment_status_lib',
  ],
  (
  error,
  log,
  record,
  serverWidget,
  config,
  accounting,
  shipmentStatus
) => {
  const { FIELDS, RECORDS } = config;

  function beforeLoad(context) {
    if (!context.form) return;
    context.form.clientScriptModulePath = './lcm_po_selection_client.js';
    renameBodyFields(context.form, [
      { fieldId: FIELDS.lcmLandedCosts.vendor, label: 'Vendor Name' },
      { fieldId: FIELDS.lcmLandedCosts.targetType, label: 'Document Type' },
      { fieldId: FIELDS.lcmLandedCosts.costItemMap, label: 'LC Cost Category' },
    ]);
    hideBodyFields(context.form, [
      FIELDS.lcmLandedCosts.billLineType,
      FIELDS.lcmLandedCosts.billType,
      FIELDS.lcmLandedCosts.subsidiary,
      FIELDS.lcmLandedCosts.costCategory,
      FIELDS.lcmLandedCosts.billItem,
      FIELDS.lcmLandedCosts.department,
      FIELDS.lcmLandedCosts.class,
    ]);
    applyBeforeLoadDefaults(context);
    addServerDebugBanner(context);
    logFormFieldInventory(context);
  }

  function applyBeforeLoadDefaults(context) {
    if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.COPY) return;

    const f = FIELDS.lcmLandedCosts;
    setFormDefaultText(context, f.targetType, config.DEFAULTS.targetTypeText);
    setFormDefaultValue(context, f.effectiveDate, new Date());
  }

  function renameBodyFields(form, fieldLabels) {
    fieldLabels.forEach((fieldLabel) => {
      try {
        const field = form.getField({ id: fieldLabel.fieldId });
        field.label = fieldLabel.label;
      } catch (error) {
        log.audit({
          title: 'LCM body field label was not changed',
          details: `${fieldLabel.fieldId}: ${error.message || error}`,
        });
      }
    });
  }

  function hideBodyFields(form, fieldIds) {
    fieldIds.forEach((fieldId) => {
      try {
        const field = form.getField({ id: fieldId });
        field.updateDisplayType({ displayType: serverWidget.FieldDisplayType.HIDDEN });
      } catch (error) {
        log.audit({
          title: 'LCM body field display was not changed',
          details: `${fieldId}: ${error.message || error}`,
        });
      }
    });
  }

  function setFormDefaultValue(context, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    try {
      if (!context.newRecord.getValue({ fieldId })) {
        context.newRecord.setValue({ fieldId, value });
      }
    } catch (recordError) {
      // Keep trying the rendered form default below.
    }

    try {
      const field = context.form.getField({ id: fieldId });
      field.defaultValue = Object.prototype.toString.call(value) === '[object Date]' ? format.format({ value, type: format.Type.DATE }) : value;
    } catch (formError) {
      log.audit({
        title: 'LCM form default value was not applied',
        details: `${fieldId}: ${formError.message || formError}`,
      });
    }
  }

  function setFormDefaultText(context, fieldId, text) {
    if (!text) return;
    try {
      if (!context.newRecord.getValue({ fieldId })) {
        context.newRecord.setText({ fieldId, text });
      }
    } catch (recordError) {
      // Keep trying the rendered form default below.
    }

    try {
      const field = context.form.getField({ id: fieldId });
      field.defaultValue = text;
    } catch (formError) {
      log.audit({
        title: 'LCM form default text was not applied',
        details: `${fieldId}: ${formError.message || formError}`,
      });
    }
  }

  function addServerDebugBanner(context) {
    if (!config.DEBUG.showServerBanner) return;
    try {
      const field = context.form.addField({
        id: 'custpage_lcm_debug_banner',
        label: 'LCM Debug',
        type: serverWidget.FieldType.INLINEHTML,
      });
      field.defaultValue =
        '<div style="margin:8px 0;padding:8px 12px;border:1px solid #b6d7a8;background:#f3fff0;color:#274e13;font:12px Arial,sans-serif;">' +
        'LCM debug: Landed Cost row User Event beforeLoad ran. Client script module path was attached. ' +
        'Change LC Cost Category and copy the LCM fieldChanged alert text.' +
        '</div>';
    } catch (error) {
      log.error({ title: 'LCM debug banner failed', details: error.message || error });
    }
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
        `Configured LC Cost Category mapping: ${FIELDS.lcmLandedCosts.costItemMap}. ` +
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
      validateBillRoutingInputs(context.newRecord);
      return;
    }
    if (!context.oldRecord) return;

    const oldStatus = context.oldRecord.getValue({ fieldId: f.processingStatus });
    const oldTranId = context.oldRecord.getValue({ fieldId: f.createdTransactionId });
    const wasCreated = normalize(oldStatus) === normalize(accounting.STATUS.created) || Boolean(oldTranId);
    if (!wasCreated) {
      if (context.type === context.UserEventType.XEDIT) {
        // An inline edit submits only the touched fields, so the full vendor/parent sourcing has
        // nothing to read. The mapping refs are self-contained and safe to derive here.
        sourceCostCategoryRefs(context.newRecord);
      } else {
        sourceVendorDefaults(context.newRecord);
      }
      // XEDIT only contains the submitted column, so it cannot prove a checkbox and its
      // companion target together. The Create Bill preview re-reads full rows and enforces
      // routing server-side; normal create/edit saves receive immediate form validation here.
      if (context.type !== context.UserEventType.XEDIT) validateBillRoutingInputs(context.newRecord);
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

  function afterSubmit(context) {
    const source = context.type === context.UserEventType.DELETE ? context.oldRecord : context.newRecord;
    if (!source) return;

    const parentId =
      getValueIfPresent(source, FIELDS.lcmLandedCosts.parent) ||
      getValueIfPresent(context.oldRecord, FIELDS.lcmLandedCosts.parent);
    if (parentId) shipmentStatus.recalculate(parentId);
  }

  function sourceVendorDefaults(rec) {
    const f = FIELDS.lcmLandedCosts;
    const parentDefaults = getParentDefaults(rec);
    setDefaultTextIfBlank(rec, f.targetType, config.DEFAULTS.targetTypeText);
    setDefaultIfBlank(rec, f.effectiveDate, new Date());
    sourceCostCategoryRefs(rec);
    sourceAllocationMethodDefault(rec);
    setTextIfPresent(rec, f.billLineType, config.DEFAULTS.billLineTypeText);
    setTextIfPresent(rec, f.billType, config.DEFAULTS.billTypeText);

    const vendorId = rec.getValue({ fieldId: f.vendor });
    if (!vendorId) {
      setValueIfPresent(rec, f.subsidiary, parentDefaults.subsidiary);
      return;
    }

    const defaults = accounting.getVendorBillDefaults(vendorId);
    setDefaultIfBlank(rec, f.subsidiary, defaults.subsidiary, defaults.subsidiaryText);
    setDefaultIfBlank(rec, f.currency, defaults.currency, defaults.currencyText);
    const currencyId = rec.getValue({ fieldId: f.currency }) || defaults.currency;
    const currencyDefaults = currencyId
      ? accounting.getVendorCurrencyDefaults(vendorId, currencyId, rec.getValue({ fieldId: f.subsidiary }) || defaults.subsidiary)
      : defaults;
    setDefaultIfBlank(rec, f.exchangeRate, currencyDefaults.exchangeRate || defaults.exchangeRate);
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
  function sourceCostCategoryRefs(rec) {
    const f = FIELDS.lcmLandedCosts;
    const selectedId = getValueIfPresent(rec, f.costItemMap);
    const selectedText = getTextIfPresent(rec, f.costItemMap);

    if (!selectedId) {
      log.audit({
        title: 'LCM LC Cost Category sourcing skipped',
        details: `No value on ${getCostCategorySourceFieldIds().join(' or ')}. Nothing to resolve an LC Cost Item from.`,
      });
      return;
    }

    const defaults = accounting.getCostItemMapDefaults(selectedId);
    if (!defaults.costCategory && !defaults.costCategoryText) return;

    const mapSet = setValueOrText(rec, f.costItemMap, defaults.costItemMap, defaults.costItemMapText);
    const categorySet = setValueOrText(rec, f.costCategory, defaults.costCategory, defaults.costCategoryText);
    const itemSet = setValueOrText(rec, f.billItem, defaults.billItem, defaults.billItemText);

    if (!itemSet) {
      log.error({
        title: 'LCM LC Cost Item was not written to the record',
        details:
          `Source field: ${f.costItemMap}. ` +
          `Selected internal id: ${selectedId || '(none)'}. Selected text: "${selectedText ||
            defaults.costItemMapText ||
            defaults.costCategoryText}". Attempted item name: "${defaults.attemptedItemName || ''}". ` +
          `Resolved item: ${defaults.billItem || '(none)'}. Target field: ${f.billItem}. ` +
          `Source: ${defaults.source || '(none)'}. Mapping record: ${defaults.mappingRecordId || '(none)'}. ` +
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
      details: `${f.costItemMap}=${selectedId} ("${defaults.costItemMapText || defaults.costCategoryText}") -> ${f.billItem}=${
        defaults.billItem
      } ("${defaults.billItemText}"). Source: ${defaults.source || '(none)'}. Mapping record: ${
        defaults.mappingRecordId || '(none)'
      }. Cost Item Map written: ${mapSet}. Cost Category written: ${categorySet}.`,
    });
  }

  function sourceAllocationMethodDefault(rec) {
    const f = FIELDS.lcmLandedCosts;
    if (rec.getValue({ fieldId: f.allocationMethod })) return;

    let costCategoryId = getValueIfPresent(rec, f.costCategory);
    if (!costCategoryId) {
      const costItemMapId = getValueIfPresent(rec, f.costItemMap);
      costCategoryId = costItemMapId ? accounting.getCostItemMapDefaults(costItemMapId).costCategory : '';
    }
    if (!costCategoryId) return;

    const defaults = accounting.getAllocationMethodDefault(costCategoryId);
    if (!defaults.allocationMethodText) return;

    try {
      rec.setText({ fieldId: f.allocationMethod, text: defaults.allocationMethodText });
    } catch (setTextError) {
      // Keep save flow moving if account-specific list text differs.
    }
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
      f.costItemMap,
      f.costCategory,
      f.amount,
      f.currency,
      f.exchangeRate,
      f.effectiveDate,
      f.allocationMethod,
      f.billItem,
      f.memo,
      f.appendExistingBill,
      f.targetVendorBill,
      f.billGroup,
    ];
  }

  function validateBillRoutingInputs(rec) {
    const f = FIELDS.lcmLandedCosts;
    const documentType = getTextIfPresent(rec, f.targetType) || getValueIfPresent(rec, f.targetType);
    if (normalize(documentType).indexOf('bill') < 0) return;

    const appendExisting = isChecked(getValueIfPresent(rec, f.appendExistingBill));
    const targetVendorBill = getValueIfPresent(rec, f.targetVendorBill);
    const billGroup = normalizeValue(getValueIfPresent(rec, f.billGroup)).trim();

    if (appendExisting && !targetVendorBill) {
      throw error.create({
        name: 'LCM_APPEND_TARGET_REQUIRED',
        message: 'Target Vendor Bill is required when Append to Existing Bill is checked.',
        notifyOff: false,
      });
    }
    if (appendExisting && billGroup) {
      throw error.create({
        name: 'LCM_APPEND_GROUP_CONFLICT',
        message: 'Bill Group must be blank when Append to Existing Bill is checked.',
        notifyOff: false,
      });
    }
    if (!appendExisting && targetVendorBill) {
      throw error.create({
        name: 'LCM_APPEND_TARGET_UNEXPECTED',
        message: 'Clear Target Vendor Bill or check Append to Existing Bill.',
        notifyOff: false,
      });
    }
  }

  function normalize(value) {
    return String(value || '').toLowerCase();
  }

  function isChecked(value) {
    return value === true || value === 'T' || value === 'true';
  }

  function setDefaultIfBlank(rec, fieldId, value, text) {
    if (rec.getValue({ fieldId })) return;
    setValueOrText(rec, fieldId, value, text);
  }

  function setDefaultTextIfBlank(rec, fieldId, text) {
    if (rec.getValue({ fieldId }) || !text) return;
    setTextIfPresent(rec, fieldId, text);
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

  function setTextIfPresent(rec, fieldId, text) {
    if (!text) return;
    try {
      rec.setText({ fieldId, text });
    } catch (error) {
      // Keep save flow moving if an account-specific list text differs.
    }
  }

  function getCostCategorySourceFieldIds() {
    const f = FIELDS.lcmLandedCosts;
    return [f.costItemMap].filter(Boolean);
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

  return { beforeLoad, beforeSubmit, afterSubmit };
});
