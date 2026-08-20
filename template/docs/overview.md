---
id: overview
title: Overview
sidebar_position: 1
---

import {WorkshopValue, WorkshopLink, WorkshopCodeBlock} from '@site/src/components/WorkshopEnv';

# __PRODUCT_TITLE__

Replace this page with the workshop introduction. The site builds as-is, so you
can start writing exercises immediately.

## Target environment

These values come from the selected target in `config/workshop-targets.json`, so
a page never hardcodes a tenant:

- Organization: <WorkshopValue field="uipathOrgName" />
- Tenant: <WorkshopValue field="uipathTenantName" />
- Tenant URL: <WorkshopLink field="uipathTenantUrl" />
- Orchestrator parent folder: <WorkshopValue field="orchestratorParentFolder" />

Tokens render inside code blocks too, which is how participants get commands they
can paste as-is:

<WorkshopCodeBlock language="bash">{`\
uip auth --org {{WORKSHOP_UIPATH_ORG_NAME}} --tenant {{WORKSHOP_UIPATH_TENANT_NAME}}
`}</WorkshopCodeBlock>

The `{'{'}{'{'}...{'}'}{'}'}` content must sit inside a JSX template literal as
above. Written as bare text, MDX reads the braces as an expression and the build
fails with `WORKSHOP_UIPATH_ORG_NAME is not defined`.

## Before your first delivery

- Replace the `REPLACE_ME` values in `config/workshop-targets.json`.
  `workshop-kit validate-config` passes regardless, so nothing else will remind
  you.
- Add a target per training tenant. Ephemeral one-off tenants can live in
  `config/targets/<name>.json` and be deleted without touching the main config.
- Put participant downloads in `downloads/<name>/`. Each directory becomes
  `static/downloads/<name>.zip`. Loose files at the `downloads/` root are not
  packaged; the build warns but does not fail.
- Every field declared in the config must be used somewhere in `docs/`, or
  `check:workshop-vars` fails. That is deliberate — it catches a field that was
  added and then forgotten.
