/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', './lcm_po_selection_config'], (error, config) => {
  const { FIELDS } = config;

  function beforeSubmit(context) {
    if (context.type === context.UserEventType.DELETE) return;

    const rec = context.newRecord;
    const f = FIELDS.lcmItems;
    const expectedQuantity = toNumber(getValue(rec, f.expectedQuantityReceipt)) || 0;
    const quantityReceipt = toNumber(getValue(rec, f.quantityReceipt)) || 0;

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
      roundCurrency((toNumber(getValue(rec, f.poRate)) || 0) * (toNumber(getValue(rec, f.exchangeRate)) || 1) * quantityReceipt)
    );
    setValueIfPresent(
      rec,
      f.totalValue,
      roundCurrency((toNumber(getValue(rec, f.totalUnitCost)) || 0) * quantityReceipt)
    );
  }

  function getValue(rec, fieldId) {
    try {
      return rec.getValue({ fieldId });
    } catch (error) {
      return '';
    }
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

  return { beforeSubmit };
});
