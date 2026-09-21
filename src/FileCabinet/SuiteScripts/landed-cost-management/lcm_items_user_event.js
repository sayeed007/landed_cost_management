/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/record', './lcm_po_selection_config', './lcm_shipment_status_lib'], (error, record, config, shipmentStatus) => {
  const { FIELDS } = config;

  function beforeSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;

    const rec = context.newRecord;
    const f = FIELDS.lcmItems;
    const changedFields = getChangedFieldMap(rec);
    const xedit = isXedit(context);
    assertReceiptFieldsAreLocked(context, f, changedFields);

    // An xedit newRecord contains only the submitted fields. Load the persisted row and
    // overlay those fields before deriving values, otherwise linking an Item Receipt could
    // accidentally recalculate quantity/value fields as zero.
    const source = loadPersistedItemForXedit(context, rec);
    const expectedQuantity = toNumber(getEffectiveValue(rec, source, f.expectedQuantityReceipt, changedFields, xedit)) || 0;
    const quantityReceipt = toNumber(getEffectiveValue(rec, source, f.quantityReceipt, changedFields, xedit)) || 0;

    if (quantityReceipt < 0) {
      throw error.create({
        name: 'LCM_NEGATIVE_RECEIPT_QTY',
        message: 'Quantity Receipt cannot be negative.',
        notifyOff: false,
      });
    }

    if (quantityReceipt > expectedQuantity) {
      throw error.create({
        name: 'LCM_RECEIPT_QTY_EXCEEDS_EXPECTED',
        message: 'Quantity Receipt cannot be greater than Expected Quantity Receipt.',
        notifyOff: false,
      });
    }

    setValueIfPresent(rec, f.quantityRemaining, Math.max(0, expectedQuantity - quantityReceipt));
    setValueIfPresent(rec, f.billStatus, expectedQuantity === quantityReceipt ? 'full' : 'partial');
    setValueIfPresent(
      rec,
      f.poValue,
      roundCurrency(
        (toNumber(getEffectiveValue(rec, source, f.poRate, changedFields, xedit)) || 0) *
          (toNumber(getEffectiveValue(rec, source, f.exchangeRate, changedFields, xedit)) || 1) *
          quantityReceipt
      )
    );
    setValueIfPresent(
      rec,
      f.totalValue,
      roundCurrency((toNumber(getEffectiveValue(rec, source, f.totalUnitCost, changedFields, xedit)) || 0) * quantityReceipt)
    );
  }

  function afterSubmit(context) {
    const source = context.type === context.UserEventType.DELETE ? context.oldRecord : context.newRecord;
    if (!source) return;

    const parentId =
      getValue(source, FIELDS.lcmItems.parent) ||
      getValue(context.oldRecord, FIELDS.lcmItems.parent);
    if (parentId) shipmentStatus.recalculate(parentId);
  }

  function getValue(rec, fieldId) {
    try {
      return rec.getValue({ fieldId });
    } catch (error) {
      return '';
    }
  }

  function getChangedFieldMap(rec) {
    const fields = {};
    try {
      (rec.getFields() || []).forEach((fieldId) => {
        fields[fieldId] = true;
      });
    } catch (error) {
      // Normal create/edit records do not need an xedit field map.
    }
    return fields;
  }

  function isXedit(context) {
    return context.type === context.UserEventType.XEDIT;
  }

  function loadPersistedItemForXedit(context, rec) {
    if (!isXedit(context) || !rec.id) return null;
    try {
      return record.load({ type: rec.type, id: rec.id, isDynamic: false });
    } catch (error) {
      return null;
    }
  }

  function getEffectiveValue(newRecord, persistedRecord, fieldId, changedFields, xedit) {
    if (!xedit || changedFields[fieldId] || !persistedRecord) return getValue(newRecord, fieldId);
    return getValue(persistedRecord, fieldId);
  }

  function assertReceiptFieldsAreLocked(context, f, changedFields) {
    if (!context.oldRecord || !context.newRecord.id) return;

    const persisted = loadPersistedItemForXedit(context, context.newRecord) || context.oldRecord;
    if (!getValue(persisted, f.itemReceipt)) return;

    const protectedFields = [f.purchaseOrder, f.item, f.poLineKey, f.quantityReceipt, f.trackItem, f.itemReceipt];
    const changed = protectedFields.some((fieldId) => {
      if (isXedit(context)) return Boolean(changedFields[fieldId]);
      return normalizeValue(getValue(context.newRecord, fieldId)) !== normalizeValue(getValue(context.oldRecord, fieldId));
    });
    if (!changed) return;

    throw error.create({
      name: 'LCM_ITEM_RECEIPT_LOCKED',
      message: 'This LCM Item is linked to an Item Receipt and its PO, item, receipt quantity, tracking, and Item Receipt reference cannot be changed.',
      notifyOff: false,
    });
  }

  function normalizeValue(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function setValueIfPresent(rec, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    try {
      rec.setValue({ fieldId, value });
    } catch (error) {
      // Keep save flow moving if a newly added derived field is not deployed yet.
    }
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }

  function roundCurrency(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  return { beforeSubmit, afterSubmit };
});
