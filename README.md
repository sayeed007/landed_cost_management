# Landed Cost Management

SuiteScript customization for `CUSTOMRECORD_LANDED_COST_MANAGEMENT`.

## Purpose

Users select Vendor and one or more Purchase Orders from the Landed Cost
Management header. Purchase Orders are filtered and validated by Vendor. The
`LCM Items` subtab is populated from the selected PO item lines immediately on
change. When a PO is removed from the header selection, the matching item lines
are removed from the UI and deleted on save.

Landed Cost rows use one visible `LC Cost Profile` selector. Scripts map that
profile to hidden native Cost Category and Bill Item references before creating
Vendor Bills.

## Structure

- `SuiteScripts/landed-cost-management/` - SuiteScript source files.
- `src/Objects/` - SDF script object/deployment XML.
- `docs/lcm_po_selection_deployment.md` - NetSuite field and deployment steps.

## Required NetSuite Fields

- Parent vendor field: `custrecord_lcm_vendor`
- Parent body field: `custrecord_lcm_selected_pos`
- Child hidden field: `custrecord_lcmitems_source_line_key`
- Child checkbox field: `custrecord_lcmitems_track_item`
- Landed Cost profile field: `custrecord_lcm_lcm_cost_profile`

## Account Constants

Before relying on new Journal rows, set the fixed account IDs in
`src/FileCabinet/SuiteScripts/landed-cost-management/lcm_po_selection_config.js`.
The current profile mapping assumes matching native Cost Category and Item names
such as `LC - Freight`; replace the mapping entries with account-specific
internal IDs when those IDs are confirmed.

See `docs/lcm_po_selection_deployment.md` for complete deployment notes.

## Deployment

Install dependencies once:

```powershell
npm install
```

Validate:

```powershell
npm run validate
```

Preview deployment:

```powershell
npm run preview
```

Deploy:

```powershell
npm run deploy
```
