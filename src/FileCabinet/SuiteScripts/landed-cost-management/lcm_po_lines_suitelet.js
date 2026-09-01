/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/log', './lcm_po_selection_lib'], (log, lib) => {
  function onRequest(context) {
    const response = context.response;
    response.setHeader({ name: 'Content-Type', value: 'application/json' });

    try {
      const poIds = lib.normalizeIds(context.request.parameters.poIds || '');
      const lines = lib.fetchPurchaseOrderItemLines(poIds);

      response.write(
        JSON.stringify({
          ok: true,
          poIds,
          lines,
        })
      );
    } catch (error) {
      log.error({ title: 'LCM PO line lookup failed', details: error });
      response.write(
        JSON.stringify({
          ok: false,
          message: error.message || String(error),
        })
      );
    }
  }

  return { onRequest };
});
