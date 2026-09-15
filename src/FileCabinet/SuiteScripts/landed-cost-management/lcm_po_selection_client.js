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
      exposeWindowCallbacks();
      announceClientLoad(currentRecord.get());
      applyLandedCostLineDefaults(currentRecord.get(), '');
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

  function lineInit(context) {
    if (syncing) return;
    if (context.sublistId !== SUBLISTS.lcmLandedCosts) return;

    syncing = true;
    try {
      applyLandedCostLineDefaults(currentRecord.get(), context.sublistId);
    } catch (error) {
      log.audit({
        title: 'LCM landed cost line defaults were not applied',
        details: error.message || error,
      });
    } finally {
      syncing = false;
    }
  }

  // N/log in a client script writes to the BROWSER CONSOLE, not the NetSuite execution log.
  // Open devtools to read these; the execution log only carries the server-side entries.
  function traceClient(title, details) {
    if (!DEBUG.traceClientEvents) return;
    const message = details ? `${title}\n${details}` : title;
    log.audit({ title, details: message });
    window.alert(message);
  }

  function announceClientLoad(rec) {
    if (!DEBUG.announceClientLoad) return;
    const reachable = listReachableFields(rec);
    const selectedCategory = getSelectedCostCategory(rec, '');
    const message =
      `LCM client loaded.\n` +
      `Record type: ${safeRecordType(rec)}\n` +
      `Cost Item Map field: ${FIELDS.lcmLandedCosts.costItemMap} reachable=${reachable.costItemMap}\n` +
      `Profile field: ${FIELDS.lcmLandedCosts.costProfile} reachable=${reachable.profile}\n` +
      `Cost Category field: ${FIELDS.lcmLandedCosts.costCategory} reachable=${reachable.costCategory}\n` +
      `LC Cost Item field: ${FIELDS.lcmLandedCosts.billItem} reachable=${reachable.item}\n` +
      `Selected source: ${selectedCategory.fieldId || '(none)'} value=${selectedCategory.value || '(blank)'} text="${selectedCategory.text ||
        ''}"`;
    traceClient('LCM client script loaded', message);
    if (!reachable.costItemMap && !reachable.profile && !reachable.costCategory) {
      window.alert(
        'LCM client script loaded, but this form has no field "' +
          FIELDS.lcmLandedCosts.costItemMap +
          '", "' +
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
      costItemMap: fieldExists(rec, FIELDS.lcmLandedCosts.costItemMap),
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
    traceFieldChanged(context);

    if (context.sublistId === SUBLISTS.lcmItems && isItemRecalculationField(context.fieldId)) {
      recalculateCurrentItemLine(currentRecord.get());
      return;
    }

    if (isLandedCostField(context, FIELDS.lcmLandedCosts.vendor)) {
      syncLandedCostVendorDefaults(currentRecord.get(), context.sublistId);
      return;
    }

    if (isLandedCostField(context, FIELDS.lcmLandedCosts.currency)) {
      syncLandedCostCurrencyExchangeRate(currentRecord.get(), context.sublistId);
      return;
    }

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

  function traceFieldChanged(context) {
    if (!DEBUG.traceClientEvents) return;
    const rec = currentRecord.get();
    const selectedCategory = getSelectedCostCategory(rec, getLandedCostSublistId(context.sublistId));
    const message =
      `LCM fieldChanged fired.\n` +
      `fieldId=${context.fieldId || '(none)'}\n` +
      `sublistId=${context.sublistId || '(body)'}\n` +
      `source candidates=${getCostProfileSourceFieldIds().join(', ')}\n` +
      `selected source=${selectedCategory.fieldId || '(none)'} value=${selectedCategory.value || '(blank)'} text="${selectedCategory.text ||
        ''}"`;
    traceClient('LCM fieldChanged trace', message);
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
    const selectedValue = selectedCategory.value;
    const selectedText = selectedCategory.text;

    if (!selectedValue && !selectedText) {
      // Reaching here on a fieldChanged for the profile field means the field id is wrong for
      // this form. Staying silent here is what made the original failure invisible.
      log.audit({
        title: 'LCM LC Cost Category sourcing skipped',
        details: `No value readable from "${getCostProfileSourceFieldIds().join('" or "')}" (sublist "${sublistId ||
          'body'}"). Either nothing is selected, or that field id does not exist on this form.`,
      });
      return;
    }

    try {
      traceClient(
        'LCM LC Cost Category matched',
        `Starting lookup.\n` +
          `sublistId=${sublistId || '(body)'}\n` +
          `source field=${selectedCategory.fieldId || '(none)'}\n` +
          `selected value=${selectedValue || '(blank)'}\n` +
          `selected text="${selectedText || ''}"\n` +
          `target item field=${FIELDS.lcmLandedCosts.billItem}\n` +
          `available current sublist fields=${getSublistFieldIds(rec, sublistId).join(', ') || '(none)'}`
      );
      const defaults =
        selectedCategory.fieldId === FIELDS.lcmLandedCosts.costItemMap
          ? fetchCostItemMapDefaults(selectedValue)
          : fetchCostProfileDefaults(selectedValue, selectedText);
      traceClient(
        'LCM LC Cost Category lookup returned',
        `costItemMap=${defaults.costItemMap || '(blank)'}\n` +
          `costItemMapText="${defaults.costItemMapText || ''}"\n` +
        `costCategory=${defaults.costCategory || '(blank)'}\n` +
          `costCategoryText="${defaults.costCategoryText || ''}"\n` +
          `attemptedItemName="${defaults.attemptedItemName || ''}"\n` +
          `billItem=${defaults.billItem || '(blank)'}\n` +
          `billItemText="${defaults.billItemText || ''}"\n` +
          `source=${defaults.source || '(none)'}\n` +
          `mappingRecordId=${defaults.mappingRecordId || '(none)'}\n` +
          `matched=${Boolean(defaults.matched)}\n` +
          `reason=${defaults.reason || '(none)'}`
      );
      const mapSet =
        selectedCategory.fieldId === FIELDS.lcmLandedCosts.costItemMap ||
        applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.costItemMap, defaults.costItemMap, defaults.costItemMapText);
      const categorySet = applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.costCategory, defaults.costCategory, defaults.costCategoryText);
      const itemSet = applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.billItem, defaults.billItem, defaults.billItemText);
      const writtenItem = getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.billItem);
      const writtenItemText = getLandedCostText(rec, sublistId, FIELDS.lcmLandedCosts.billItem);

      log.audit({
        title: 'LCM LC Cost Category sourcing',
        details:
          `Source field: ${selectedCategory.fieldId || '(none)'}. ` +
          `Selected internal id: ${selectedValue || '(none)'}. ` +
          `Selected text: "${selectedText || defaults.costItemMapText || defaults.costCategoryText}". ` +
          `Attempted item name: "${defaults.attemptedItemName || ''}". ` +
          `Resolved item: ${defaults.billItem || '(none)'}. Written to form: ${itemSet}. ` +
          `Source: ${defaults.source || '(none)'}. Mapping record: ${defaults.mappingRecordId || '(none)'}. ` +
          `Reason: ${defaults.reason || '(none)'}`,
      });

      traceClient(
        'LCM LC Cost Item write result',
        `costItemMapSet=${mapSet}\n` +
          `costCategorySet=${categorySet}\n` +
          `itemSet=${itemSet}\n` +
          `target field=${FIELDS.lcmLandedCosts.billItem}\n` +
          `current target value=${writtenItem || '(blank)'}\n` +
          `current target text="${writtenItemText || ''}"\n` +
          `expected item=${defaults.billItem || '(blank)'} "${defaults.billItemText || ''}"\n` +
          `server save fallback=${defaults.billItem && !itemSet ? 'yes' : 'not needed'}`
      );

      if (!itemSet) {
        if (defaults.billItem) {
          log.audit({
            title: 'LCM LC Cost Item deferred to save',
            details:
              `Item ${defaults.billItem} ("${defaults.billItemText}") was found, but field ${FIELDS.lcmLandedCosts.billItem} ` +
              'did not accept a browser-side current-line write on this form. The child record User Event will set it on save.',
          });
        } else {
          window.alert(
            `No active LC Cost Item mapping was found for "${defaults.costItemMapText || defaults.costCategoryText || selectedText}", ` +
              `so LC Cost Item was left empty.

${defaults.reason || ''}`
          );
        }
      }
    } catch (error) {
      log.error({
        title: 'LCM cost profile defaults were not sourced',
        details: error.message || error,
      });
      if (selectedCategory.fieldId !== FIELDS.lcmLandedCosts.costItemMap) {
        applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.costCategory, selectedValue, selectedText);
      }
      window.alert(
        `LC Cost Item could not be looked up: ${error.message || error}

` +
          'It will still be set when the record is saved.'
      );
    }
    syncLandedCostVendorDefaults(rec, sublistId);
    syncAllocationMethodDefault(rec, contextSublistId);
  }

  function syncLandedCostVendorDefaults(rec, contextSublistId) {
    const sublistId = getLandedCostSublistId(contextSublistId);
    const vendorId = getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.vendor);
    if (!vendorId) return;

    try {
      const defaults = fetchVendorBillDefaults(vendorId);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.currency, defaults.currency, defaults.currencyText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.exchangeRate, defaults.exchangeRate);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.expenseAccount, defaults.expenseAccount, defaults.expenseAccountText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.billLineType, '', config.DEFAULTS.billLineTypeText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.billType, '', config.DEFAULTS.billTypeText);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.subsidiary, defaults.subsidiary, defaults.subsidiaryText);
      applyLandedCostLineDefaults(rec, sublistId);
    } catch (error) {
      log.audit({
        title: 'LCM landed cost row vendor defaults were not sourced',
        details: error.message || error,
      });
    }
  }

  function syncLandedCostCurrencyExchangeRate(rec, contextSublistId) {
    const sublistId = getLandedCostSublistId(contextSublistId);
    const vendorId =
      getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.vendor) ||
      safeGetValue(rec, FIELDS.landedCostManagement.vendor);
    const currencyId = getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.currency);
    const subsidiaryId =
      getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.subsidiary) ||
      safeGetValue(rec, FIELDS.landedCostManagement.subsidiary);

    if (!vendorId || !currencyId) return;

    try {
      const defaults = fetchVendorCurrencyDefaults(vendorId, currencyId, subsidiaryId);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.exchangeRate, defaults.exchangeRate);
    } catch (error) {
      log.audit({
        title: 'LCM currency exchange rate default was not sourced',
        details: error.message || error,
      });
    }
  }

  function applyLandedCostLineDefaults(rec, contextSublistId) {
    const sublistId = getLandedCostSublistId(contextSublistId);
    setDefaultTextIfBlank(rec, sublistId, FIELDS.lcmLandedCosts.targetType, config.DEFAULTS.targetTypeText);
    setDefaultValueIfBlank(rec, sublistId, FIELDS.lcmLandedCosts.effectiveDate, new Date());
    applyDefaultPoLocation(rec, sublistId);
  }

  function applyDefaultPoLocation(rec, sublistId) {
    if (getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.location)) return;

    const selectedPoIds = normalizeIds(safeGetValue(rec, FIELDS.landedCostManagement.selectedPurchaseOrders));
    if (!selectedPoIds.length) return;

    try {
      const defaults = fetchSelectedPoDefaults(selectedPoIds);
      applyDefault(rec, sublistId, FIELDS.lcmLandedCosts.location, defaults.location, defaults.locationText);
    } catch (error) {
      log.audit({
        title: 'LCM PO location default was not sourced',
        details: error.message || error,
      });
    }
  }

  function isItemRecalculationField(fieldId) {
    return [
      FIELDS.lcmItems.quantityReceipt,
      FIELDS.lcmItems.expectedQuantityReceipt,
      FIELDS.lcmItems.poRate,
      FIELDS.lcmItems.exchangeRate,
      FIELDS.lcmItems.totalUnitCost,
    ].indexOf(fieldId) >= 0;
  }

  function recalculateCurrentItemLine(rec) {
    const sublistId = SUBLISTS.lcmItems;
    const expectedQuantity = toNumber(getCurrentSublistValue(rec, sublistId, FIELDS.lcmItems.expectedQuantityReceipt)) || 0;
    const quantityReceipt = toNumber(getCurrentSublistValue(rec, sublistId, FIELDS.lcmItems.quantityReceipt)) || 0;
    const poRate = toNumber(getCurrentSublistValue(rec, sublistId, FIELDS.lcmItems.poRate)) || 0;
    const exchangeRate = toNumber(getCurrentSublistValue(rec, sublistId, FIELDS.lcmItems.exchangeRate)) || 1;
    const totalUnitCost = toNumber(getCurrentSublistValue(rec, sublistId, FIELDS.lcmItems.totalUnitCost)) || 0;

    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.quantityRemaining, Math.max(0, expectedQuantity - quantityReceipt));
    setCurrentIfPresent(
      rec,
      sublistId,
      FIELDS.lcmItems.billStatus,
      expectedQuantity === quantityReceipt ? 'full' : 'partial'
    );
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.poValue, roundCurrency(poRate * exchangeRate * quantityReceipt));
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.totalValue, roundCurrency(totalUnitCost * quantityReceipt));
  }

  function getCurrentSublistValue(rec, sublistId, fieldId) {
    try {
      return rec.getCurrentSublistValue({ sublistId, fieldId });
    } catch (error) {
      return '';
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

  function syncAllocationMethodDefault(rec, contextSublistId) {
    const sublistId = getLandedCostSublistId(contextSublistId);
    try {
      let costCategoryId =
        getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.costCategory) ||
        getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.costProfile);
      if (!costCategoryId) {
        const costItemMapId = getLandedCostValue(rec, sublistId, FIELDS.lcmLandedCosts.costItemMap);
        costCategoryId = costItemMapId ? fetchCostItemMapDefaults(costItemMapId).costCategory : '';
      }
      if (!costCategoryId) return;

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
    return [f.costItemMap, f.costProfile, f.costCategory].filter((fieldId, index, fieldIds) => fieldId && fieldIds.indexOf(fieldId) === index);
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

  function fetchVendorCurrencyDefaults(vendorId, currencyId, subsidiaryId) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        action: 'vendorCurrencyDefaults',
        vendorId,
        currencyId,
        subsidiaryId: subsidiaryId || '',
      },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return currency exchange defaults.');
    return payload.defaults || {};
  }

  function fetchSelectedPoDefaults(poIds) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        action: 'selectedPoDefaults',
        poIds: normalizeIds(poIds).join(','),
      },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return selected PO defaults.');
    return payload.defaults || {};
  }

  // Resolved server side through the Suitelet rather than with a client-side N/search, so the
  // client and the beforeSubmit path always agree on which category/item a mapping row carries.
  function fetchCostItemMapDefaults(costItemMapId) {
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        action: 'costItemMapDefaults',
        costItemMapId: costItemMapId || '',
      },
    });
    const response = https.get({ url: suiteletUrl });
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return LC Cost Category mapping defaults.');
    return payload.defaults || {};
  }

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
    traceClient(
      'LCM calling costProfileDefaults Suitelet',
      `action=costProfileDefaults\n` +
        `costCategoryId=${costCategoryId || '(blank)'}\n` +
        `costCategoryText="${costCategoryText || ''}"\n` +
        `url=${suiteletUrl}`
    );
    const response = https.get({ url: suiteletUrl });
    traceClient(
      'LCM costProfileDefaults Suitelet responded',
      `response code=${response.code || '(none)'}\n` +
        `response body=${String(response.body || '').slice(0, 900)}`
    );
    const payload = JSON.parse(response.body || '{}');
    if (!payload.ok) throw new Error(payload.message || 'Suitelet did not return LC Cost Category defaults.');
    return payload.defaults || {};
  }

  function getSublistFieldIds(rec, sublistId) {
    if (!sublistId) return [];
    try {
      return rec.getSublistFields({ sublistId }) || [];
    } catch (error) {
      return [`unavailable: ${error.message || error}`];
    }
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

  function openLcmAllocationRecalculation() {
    const rec = currentRecord.get();
    if (!rec.id) {
      window.alert('Save the Landed Cost Management record before recalculating landed cost.');
      return;
    }

    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.accountingSuitelet.scriptId,
      deploymentId: SCRIPTS.accountingSuitelet.deploymentId,
      params: {
        parentId: rec.id,
        action: 'allocationPreview',
      },
    });

    window.open(suiteletUrl, '_blank');
  }


  function openReceivablePoSelector() {
    exposeWindowCallbacks();
    const rec = currentRecord.get();
    const vendorId = safeGetValue(rec, FIELDS.landedCostManagement.vendor);
    if (!vendorId) {
      window.alert('Select Purchase Order Vendor before selecting Purchase Orders.');
      return;
    }

    const selectedPoIds = normalizeIds(
      rec.getValue({ fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders })
    );
    const suiteletUrl = url.resolveScript({
      scriptId: SCRIPTS.poSelectorSuitelet.scriptId,
      deploymentId: SCRIPTS.poSelectorSuitelet.deploymentId,
      params: {
        vendorId,
        selectedPoIds: selectedPoIds.join(','),
      },
    });

    window.open(
      suiteletUrl,
      'lcmReceivablePoSelector',
      'width=980,height=720,resizable=yes,scrollbars=yes'
    );
  }

  function showPoSelectionLockedMessage() {
    window.alert(
      'Selected Purchase Orders cannot be changed after any Landed Cost row has created a Bill or Journal Entry.'
    );
  }

  function applyReceivablePoSelection(poIdsInput) {
    const poIds = normalizeIds(poIdsInput);
    const rec = currentRecord.get();

    syncing = true;
    try {
      rec.setValue({
        fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders,
        value: poIds,
        ignoreFieldChange: true,
      });
      syncItemSublist(rec);
    } catch (error) {
      log.error({ title: 'LCM receivable PO selection failed', details: error });
      window.alert(`Unable to apply selected receivable PO(s): ${error.message || error}`);
    } finally {
      syncing = false;
    }
  }

  function exposeWindowCallbacks() {
    if (typeof window === 'undefined') return;
    window.lcmApplyReceivablePoSelection = applyReceivablePoSelection;
  }

  function syncItemSublist(rec) {
    const selectedPoIds = normalizeIds(
      rec.getValue({ fieldId: FIELDS.landedCostManagement.selectedPurchaseOrders })
    );
    const vendorId = safeGetValue(rec, FIELDS.landedCostManagement.vendor);
    if (selectedPoIds.length && !vendorId) {
      throw new Error('Select Purchase Order Vendor before selecting Purchase Orders.');
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
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.quantityReceipt, poLine.quantityReceipt);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.expectedQuantityReceipt, poLine.expectedQuantityReceipt);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.quantityRemaining, poLine.quantityRemaining);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.billStatus, poLine.billStatus);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.unitType, poLine.unitType);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.poCurrencyText, poLine.poCurrencyText);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.poRate, poLine.poRate);
    setCurrentIfPresent(rec, sublistId, FIELDS.lcmItems.poValue, poLine.poValue);
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
        if (fieldValueMatches(readFieldValue(rec, sublistId, fieldId), value)) return true;
        log.audit({
          title: 'LCM default value set did not stick',
          details: `${fieldId}: attempted ${value}, read back ${readFieldValue(rec, sublistId, fieldId) || '(blank)'}`,
        });
      } catch (valueError) {
        log.audit({
          title: 'LCM default value set failed',
          details: `${fieldId}: ${valueError.message || valueError}`,
        });
      }

      if (sublistId && setLegacyCurrentLineValue(sublistId, fieldId, value)) {
        if (fieldValueMatches(readFieldValue(rec, sublistId, fieldId), value)) return true;
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
        if (fieldTextMatches(readFieldText(rec, sublistId, fieldId), text) || hasAnyValue(readFieldValue(rec, sublistId, fieldId))) {
          return true;
        }
        log.audit({
          title: 'LCM default text set did not stick',
          details: `${fieldId}: attempted "${text}", read back "${readFieldText(rec, sublistId, fieldId) || ''}"`,
        });
      } catch (textError) {
        log.audit({
          title: 'LCM default text set failed',
          details: `${fieldId}: ${textError.message || textError}`,
        });
      }

      if (sublistId && setLegacyCurrentLineText(sublistId, fieldId, text)) {
        if (fieldTextMatches(readFieldText(rec, sublistId, fieldId), text) || hasAnyValue(readFieldValue(rec, sublistId, fieldId))) {
          return true;
        }
      }
    }

    return false;
  }

  function readFieldValue(rec, sublistId, fieldId) {
    return sublistId ? getLandedCostValue(rec, sublistId, fieldId) : safeGetValue(rec, fieldId);
  }

  function readFieldText(rec, sublistId, fieldId) {
    return getLandedCostText(rec, sublistId, fieldId);
  }

  function fieldValueMatches(actual, expected) {
    if (Array.isArray(actual)) return actual.map(String).indexOf(String(expected)) >= 0;
    return String(actual || '') === String(expected || '');
  }

  function fieldTextMatches(actual, expected) {
    return String(actual || '').trim() === String(expected || '').trim();
  }

  function hasAnyValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  }

  function setLegacyCurrentLineValue(sublistId, fieldId, value) {
    try {
      if (typeof nlapiSetCurrentLineItemValue !== 'function') return false;
      nlapiSetCurrentLineItemValue(sublistId, fieldId, String(value), false, true);
      return true;
    } catch (error) {
      log.audit({
        title: 'LCM legacy default value set failed',
        details: `${fieldId}: ${error.message || error}`,
      });
      return false;
    }
  }

  function setLegacyCurrentLineText(sublistId, fieldId, text) {
    try {
      if (typeof nlapiSetCurrentLineItemText !== 'function') return false;
      nlapiSetCurrentLineItemText(sublistId, fieldId, text, false, true);
      return true;
    } catch (error) {
      log.audit({
        title: 'LCM legacy default text set failed',
        details: `${fieldId}: ${error.message || error}`,
      });
      return false;
    }
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

  function setDefaultTextIfBlank(rec, sublistId, fieldId, text) {
    if (!text || getLandedCostValue(rec, sublistId, fieldId)) return;
    setTextIfPresent(rec, sublistId, fieldId, text);
  }

  function setDefaultValueIfBlank(rec, sublistId, fieldId, value) {
    if (value === null || value === undefined || value === '' || getLandedCostValue(rec, sublistId, fieldId)) return;
    if (sublistId) {
      setCurrentIfPresent(rec, sublistId, fieldId, value);
      return;
    }
    try {
      rec.setValue({ fieldId, value, ignoreFieldChange: true });
    } catch (error) {
      log.audit({
        title: 'LCM default value set failed',
        details: `${fieldId}: ${error.message || error}`,
      });
    }
  }

  return {
    pageInit,
    lineInit,
    fieldChanged,
    openReceivablePoSelector,
    showPoSelectionLockedMessage,
    applyReceivablePoSelection,
    openLcmAccountingPreview,
    openLcmAllocationRecalculation,
    selectAllLcmTrackItems,
  };
});
