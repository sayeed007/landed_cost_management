/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord', 'N/https', 'N/log', 'N/url', './lcm_po_selection_config'], (
  currentRecord,
  https,
  log,
  url,
  config
) => {
  const { FIELDS, SUBLISTS, SCRIPTS, DEBUG } = config;
  let syncing = false;

  function pageInit() {
    if (syncing) return;
    syncing = true;
    try {
      announceClientLoad(currentRecord.get());
      syncCostProfileDefaults(currentRecord.get(), '');
    } catch (error) {
      log.error({
        title: 'LCM cost profile page init sync failed',
        details: error.message || error,
      });
    } finally {
      syncing = false;
    }
  }

  // N/log in a client script writes to the BROWSER CONSOLE, not the NetSuite execution log.
  // Open devtools to read these; the execution log only carries the server-side entries.
  function announceClientLoad(rec) {
    if (!DEBUG.announceClientLoad) return;
    const reachable = listReachableFields(rec);
    log.audit({
      title: 'LCM client script loaded',
      details:
        `Record type: ${safeRecordType(rec)}. ` +
        `Looking for LC Cost Profile on "${getCostProfileSourceFieldIds().join('" or "')}" and ` +
        `LC Cost Item on "${FIELDS.lcmLandedCosts.billItem}". ` +
        `Profile field reachable: ${reachable.profile}. Cost Category field reachable: ${reachable.costCategory}. ` +
        `Item field reachable: ${reachable.item}.`,
    });
    if (!reachable.profile && !reachable.costCategory) {
      window.alert(
        'LCM client script loaded, but this form has no field "' +
          FIELDS.lcmLandedCosts.costProfile +
          '" or "' +
          FIELDS.lcmLandedCosts.costCategory +
          '". LC Cost Item cannot be auto-filled until the field id in lcm_po_selection_config.js ' +
          'matches the form. See the LCM Landed Cost form field inventory entry in the script ' +
          'execution log for the real field ids.'
      );
    }
  }

  function listReachableFields(rec) {
    return {
      profile: fieldExists(rec, FIELDS.lcmLandedCosts.costProfile),
      costCategory: fieldExists(rec, FIELDS.lcmLandedCosts.costCategory),
      item: fieldExists(rec, FIELDS.lcmLandedCosts.billItem),
    };
  }

  function fieldExists(rec, fieldId) {
    try {
      rec.getField({ fieldId });
      return true;
    } catch (error) {
      try {
        rec.getValue({ fieldId });
        return true;
      } catch (valueError) {
        return false;
      }
    }
  }

  function safeRecordType(rec) {
    try {
      return rec.type || '(unknown)';
    } catch (error) {
      return '(unknown)';
    }
  }

  function normalizeIds(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    return String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function fieldChanged(context) {
    if (syncing) return;

    if (!context.sublistId && context.fieldId === FIELDS.landedCostManagement.vendor) {
      syncHeaderVendorDefaults(currentRecord.get());
      return;
    }

    if (isLandedCostField(context, getCostProfileSourceFieldIds())) {
      syncCostProfileDefaults(currentRecord.get(), context.sublistId);
      return;
    }

    if (context.fieldId !== FIELDS.landedCostManagement.selectedPurchaseOrders) return;

    syncing = true;
    try {
      syncItemSublist(currentRecord.get());
    } catch (error) {
      log.error({ title: 'LCM PO selection sync failed', details: error });
      window.alert(`Unable to refresh LCM item lines from selected PO(s): ${error.message || error}`);
    } finally {
      syncing = false;
    }
  }

  function isLandedCostField(context, fieldId) {
    const fieldIds = Array.isArray(fieldId) ? fieldId : [fieldId];
    return (context.sublistId === SUBLISTS.lcmLandedCosts || !context.sublistId) && fieldIds.indexOf(context.fieldId) >= 0;
  }

  function syncHeaderVendorDefaults(rec) {
    const vendorId = safeGetValue(rec, FIELDS.landedCostManagement.vendor);
    if (!vendorId) return;

    try {
      const defaults = fetchVendorBillDefaults(vendorId);
      applyDefault(rec, '', FIELDS.landedCostManagement.subsidiary, defaults.subsidiary, defaults.subsidiaryText);
      rec.setValue({
        fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders,
        value: [],
        ignoreFieldChange: true,
      });
      clearItemSublist(rec);
    } catch (error) {
      log.audit({
        title: 'LCM header vendor defaults were not sourced',
        details: error.message || error,
      });
    }
  }

  function syncCostProfileDefaults(rec, contextSublistId) {
    const sublistId = getLandedCostSublistId(contextSublistId);
    const selectedCategory = getSelectedCostCategory(rec, sublistId);
    const costCategoryId = selectedCategory.value;
    const costCategoryText = selectedCategory.text;

    if (!costCategoryId && !costCategoryText) {
      // Reaching here on a fieldChanged for the profile field means the field id is wrong for
      // this form. Staying silent here is what made the original failure invisible.
      log.audit({
        title: 'LCM LC Cost Profile sourcing skipped',
        details: `No value readable from "${getCostProfileSourceFieldIds().join('" or "')}" (sublist "${sublistId ||
          'body'}"). Either nothing is selected, or that field id does not exist on this form.`,
      });
      return;
    }

    try {
      const defaults = fetchCostProfileDefaults(costCategoryId, costCategoryText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.costCategory, defaults.costCategory, defaults.costCategoryText);
      const itemSet = applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.billItem, defaults.billItem, defaults.billItemText);

      log.audit({
        title: 'LCM LC Cost Profile sourcing',
        details:
          `Source field: ${selectedCategory.fieldId || '(none)'}. ` +
          `Cost Profile internal id: ${costCategoryId || '(none)'}. ` +
          `Cost Profile text: "${costCategoryText || defaults.costCategoryText}". ` +
          `Attempted item name: "${defaults.attemptedItemName || ''}". ` +
          `Resolved item: ${defaults.billItem || '(none)'}. Written to form: ${itemSet}. ` +
          `Reason: ${defaults.reason || '(none)'}`,
      });

      if (!itemSet) {
        window.alert(
          defaults.billItem
            ? `LC Cost Item ${defaults.billItem} ("${defaults.billItemText}") was found, but field "${
                FIELDS.lcmLandedCosts.billItem
              }" would not accept it on this form. It will still be set on save.`
            : `No active item is named exactly "${defaults.costCategoryText || costCategoryText}", ` +
              `so LC Cost Item was left empty.

${defaults.reason || ''}`
        );
      }
    } catch (error) {
      log.error({
        title: 'LCM cost profile defaults were not sourced',
        details: error.message || error,
      });
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.costCategory, costCategoryId, costCategoryText);
      window.alert(
        `LC Cost Item could not be looked up: ${error.message || error}

` +
          'It will still be set when the record is saved.'
      );
    }
    copyHeaderDefaultsToLandedCostLine(rec, sublistId);
    syncAllocationMethodDefault(rec, contextSublistId);
  }

  function copyHeaderDefaultsToLandedCostLine(rec, sublistId) {
    const vendorId = safeGetValue(rec, FIELDS.landedCostManagement.vendor);
    const subsidiaryId = safeGetValue(rec, FIELDS.landedCostManagement.subsidiary);
    applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.vendor, vendorId);
    applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.subsidiary, subsidiaryId);
    if (!vendorId) return;

    try {
      const defaults = fetchVendorBillDefaults(vendorId);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.currency, defaults.currency, defaults.currencyText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.exchangeRate, defaults.exchangeRate);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.billType, defaults.billType, defaults.billTypeText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.expenseAccount, defaults.expenseAccount, defaults.expenseAccountText);
    } catch (error) {
      log.audit({
        title: 'LCM landed cost row vendor defaults were not sourced',
        details: error.message || error,
      });
    }
  }

  function syncAllocationMethodDefault(rec, contextSublistId) {
    const sublistId = getLandedCostSublistId(contextSublistId);
    const costCategoryId =
      getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.costCategory) ||
      getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.costProfile);
    if (!costCategoryId) return;

    try {
      const defaults = fetchAllocationMethodDefault(costCategoryId);
      setTextIfPresent(rec, sublistId, FIELDS.lcmLandedCosts.allocationMethod, defaults.allocationMethodText);
    } catch (error) {
      log.audit({
        title: 'LCM allocation method default was not sourced',
        details: error.message || error,
      });
    }
  }

  function getLandedCostSublistId(contextSublistId) {
    return contextSublistId === SUBLISTS.lcmLandedCosts ? contextSublistId : '';
  }

  function getCostProfileSourceFieldIds() {
    const f = FIELDS.lcmLandedCosts;
    return [f.costProfile, f.costCategory].filter((fieldId, index, fieldIds) => fieldId && fieldIds.indexOf(fieldId) === index);
  }

  function getSelectedCostCategory(rec, sublistId) {
    const fieldIds = getCostProfileSourceFieldIds();
    for (let index = 0; index < fieldIds.length; index += 1) {
      const fieldId = fieldIds[index];
      const value = getLandedCostValue(rec, sublistId, fieldId);
      const text = getLandedCostText(rec, sublistId, fieldId);
      if (value || text) return { fieldId, value, text };
    }
    return { fieldId: '', value: '', text: '' };
  }

  function getLandedCostValue(rec, sublistId, fieldId) {
    try {
      if (sublistId) {
        return rec.getCurrentSublistValue({ sublistId, fieldId });
      }
      return rec.getValue({ fieldId });
    } catch (error) {
      return '';
    }
  }

  function getLandedCostText(rec, sublistId, fieldId) {
    try {
      if (sublistId) {
        return rec.getCurrentSublistText({ sublistId, fieldId });
      }
      return rec.getText({ fieldId });
    } catch (error) {
      return '';
    }
  }

  function fetchVendorBillDefaults(vendorId) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        action: 'vendorDefaults',
        vendorId,
      },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return vendor bill defaults.');
    return payload.defaults || {};
  }

  // Resolved server side through the Suitelet rather than with a client-side N/search, so the
  // client and the beforeSubmit fallback always agree on which item a profile maps to.
  function fetchCostProfileDefaults(costCategoryId, costCategoryText) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        action: 'costProfileDefaults',
        costCategoryId: costCategoryId || '',
        costCategoryText: costCategoryText || '',
      },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return LC Cost Profile defaults.');
    return payload.defaults || {};
  }

  function fetchAllocationMethodDefault(costCategoryId) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        action: 'allocationMethodDefault',
        costCategoryId,
      },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return allocation defaults.');
    return payload.defaults || {};
  }

  function selectAllLcmTrackItems() {
    const rec = currentRecord.get();
    const sublistId = SUBLISTS.lcmItems;
    const count = rec.getLineCount({ sublistId }) || 0;

    try {
      for (let line = 0; line < count; line += 1) {
        rec.selectLine({ sublistId, line });
        setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.trackItem, true);
        rec.commitLine({ sublistId, ignoreRecalc: true });
      }
    } catch (error) {
      log.error({ title: 'LCM select all track items failed', details: error });
      window.alert(`Unable to select all Track Item checkboxes: ${error.message || error}`);
    }
  }

  function openLcmAccountingPreview(mode) {
    const rec = currentRecord.get();
    if (!rec.id) {
      window.alert('Save the Landed Cost Management record before creating accounting transactions.');
      return;
    }

    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        parentId: rec.id,
        mode: mode || 'bill',
      },
    });

    window.open(suiteletUrl, '_blank');
  }

  function syncItemSublist(rec) {
    const selectedPoIds = normalizeIds(
      rec.getValue({ fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders })
    );
    const vendorId = safeGetValue(rec, FIELDS.landedCostManagement.vendor);
    if (selectedPoIds.length && !vendorId) {
      throw new Error('Select Vendor before selecting Purchase Orders.');
    }
    const poLines = selectedPoIds.length ? fetchPoLines(selectedPoIds, vendorId) : [];

    clearItemSublist(rec);
    poLines.forEach((poLine) => addItemLine(rec, poLine));
  }

  function fetchPoLines(poIds, vendorId) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.poLinesSuitelet.scriptId,
      deploymentId: SCRIPTS.poLinesSuitelet.deploymentId,
      params: { poIds: poIds.join(','), vendorId: vendorId || '' },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');

    if (!payload.ok) {
      throw new Error(payload.message || 'Suitelet did not return PO item lines.');
    }

    return payload.lines || [];
  }

  function clearItemSublist(rec) {
    const sublistId = SUBLISTS.lcmItems;
    const count = rec.getLineCount({ sublistId }) || 0;

    for (let line = count - 1; line >= 0; line -= 1) {
      rec.removeLine({ sublistId, line, ignoreRecalc: true });
    }
  }

  function addItemLine(rec, poLine) {
    const sublistId = SUBLISTS.lcmItems;
    rec.selectNewLine({ sublistId });

    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.vendor, poLine.vendorId);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.purchaseOrder, poLine.poId);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.item, poLine.itemId);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.description, poLine.description || poLine.itemText);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.quantityReceipt, poLine.quantityReceived);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.expectedQuantityReceipt, poLine.quantity);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.quantityRemaining, poLine.quantityRemaining);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.quantityBill, poLine.quantityBilled);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.unitType, poLine.unitType);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.poRate, poLine.poRate);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.exchangeRate, poLine.exchangeRate);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.trackItem, false);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.poLineKey, poLine.poLineKey);

    rec.commitLine({ sublistId, ignoreRecalc: true });
  }

  function setCurrentIfPresent(rec, sublistId, fieldId, value) {
    if (value === null || value === undefined || value === '') return;
    rec.setCurrentSublistValue({
      sublistId,
      fieldId,
      value,
      ignoreFieldChange: true,
      forceSyncSourcing: true,
    });
  }

  function safeGetValue(rec, fieldId) {
    try {
      return rec.getValue({ fieldId });
    } catch (error) {
      return '';
    }
  }

  function applyDefault(rec, sublistId, fieldId, value, text) {
    if (value !== null && value !== undefined && value !== '') {
      try {
        if (sublistId) {
          rec.setCurrentSublistValue({
            sublistId,
            fieldId,
            value,
            ignoreFieldChange: true,
            forceSyncSourcing: true,
          });
        } else {
          rec.setValue({
            fieldId,
            value,
            ignoreFieldChange: true,
          });
        }
        return true;
      } catch (valueError) {
        log.audit({
          title: 'LCM default value set failed',
          details: `${fieldId}: ${valueError.message || valueError}`,
        });
      }
    }

    if (text) {
      try {
        if (sublistId) {
          rec.setCurrentSublistText({
            sublistId,
            fieldId,
            text,
            ignoreFieldChange: true,
            forceSyncSourcing: true,
          });
        } else {
          rec.setText({
            fieldId,
            text,
            ignoreFieldChange: true,
          });
        }
        return true;
      } catch (textError) {
        log.audit({
          title: 'LCM default text set failed',
          details: `${fieldId}: ${textError.message || textError}`,
        });
      }
    }

    return false;
  }

  function setTextIfPresent(rec, sublistId, fieldId, text) {
    if (!text) return;
    try {
      if (sublistId) {
        rec.setCurrentSublistText({
          sublistId,
          fieldId,
          text,
          ignoreFieldChange: true,
        });
      } else {
        rec.setText({
          fieldId,
          text,
          ignoreFieldChange: true,
        });
      }
    } catch (error) {
      log.audit({
        title: 'LCM set current sublist text failed',
        details: error.message || error,
      });
    }
  }

  return { pageInit, fieldChanged, openLcmAccountingPreview, selectAllLcmTrackItems };
});
