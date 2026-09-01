# Landed Cost Management

SuiteScript customization for `CUSTOMRECORD_LANDED_COST_MANAGEMENT`.

## Purpose

Users select one or more Purchase Orders from the Landed Cost Management header.
The `LCM Items` subtab is populated from the selected PO item lines immediately
on change. When a PO is removed from the header selection, the matching item
lines are removed from the UI and deleted on save.

## Structure

- `SuiteScripts/landed-cost-management/` - SuiteScript source files.
- `src/Objects/` - SDF script object/deployment XML.
- `docs/lcm_po_selection_deployment.md` - NetSuite field and deployment steps.

## Required NetSuite Fields

- Parent body field: `custrecord_lcm_selected_pos`
- Child hidden field: `custrecord_lcmitems_source_line_key`
- Child checkbox field: `custrecord_lcmitems_track_item`

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
