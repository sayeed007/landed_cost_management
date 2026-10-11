/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], () => {
  let submitting = false;

  function fieldChanged(context) {
    if (submitting || context.fieldId !== 'custpage_lcm_id') return;

    const selectedLcmId = context.currentRecord.getValue({ fieldId: 'custpage_lcm_id' });
    if (!selectedLcmId) return;

    submitting = true;
    try {
      context.currentRecord.setValue({
        fieldId: 'custpage_action',
        value: 'reviewItemReceipt',
        ignoreFieldChange: true,
      });
    } catch (error) {
      // The picker still submits through the visible button if the hidden action is unavailable.
    }
    const submitButton = document.getElementById('submitter');
    if (submitButton && typeof submitButton.click === 'function') {
      submitButton.click();
      return;
    }

    const form = document.forms && document.forms[0];
    if (form) form.submit();
  }

  return { fieldChanged };
});
