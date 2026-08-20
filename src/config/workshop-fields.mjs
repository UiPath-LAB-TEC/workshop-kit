#!/usr/bin/env node
/**
 * The single place that knows which workshop fields exist and which
 * {{WORKSHOP_*}} token renders each one.
 *
 * Before the kit, adding one product-specific field (`codexModel`) required four
 * coordinated edits: config/workshop-targets.json, the WorkshopTarget type in
 * docusaurus.config.ts, the customFields.workshop payload, and both the type and
 * the token map in WorkshopEnv.tsx. Miss one and the failure was silent.
 *
 * Now a repo declares it once, in config/workshop-targets.json:
 *
 *   "extraFields": {
 *     "codexModel": { "type": "string", "token": "WORKSHOP_CODEX_MODEL" }
 *   }
 *
 * and everything below is derived from that.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** Present in every workshop, in every repo. */
export const BASE_FIELDS = Object.freeze({
  uipathOrgName: 'WORKSHOP_UIPATH_ORG_NAME',
  uipathTenantName: 'WORKSHOP_UIPATH_TENANT_NAME',
  uipathTenantUrl: 'WORKSHOP_UIPATH_TENANT_URL',
  orchestratorParentFolder: 'WORKSHOP_ORCHESTRATOR_PARENT_FOLDER',
});

export function readTargetsConfig(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, 'config', 'workshop-targets.json'), 'utf8'));
}

/**
 * @returns {{field: string, token: string, extra: boolean}[]} every field this
 *   repo declares, base fields first, then extras in declaration order.
 */
export function resolveFields(config) {
  const fields = Object.entries(BASE_FIELDS).map(([field, token]) => ({
    field,
    token,
    extra: false,
  }));

  const seenFields = new Set(fields.map((entry) => entry.field));
  const seenTokens = new Set(fields.map((entry) => entry.token));

  for (const [field, declaration] of Object.entries(config.extraFields || {})) {
    if (seenFields.has(field)) {
      throw new Error(
        `extraFields.${field} collides with a base workshop field; base fields are ${Object.keys(BASE_FIELDS).join(', ')}.`,
      );
    }
    const token = declaration?.token;
    if (!token) {
      throw new Error(`extraFields.${field} is missing a "token".`);
    }
    if (!/^WORKSHOP_[A-Z0-9_]+$/.test(token)) {
      throw new Error(`extraFields.${field} token "${token}" must match WORKSHOP_[A-Z0-9_]+.`);
    }
    if (seenTokens.has(token)) {
      throw new Error(`extraFields.${field} reuses token ${token}, which is already declared.`);
    }
    seenFields.add(field);
    seenTokens.add(token);
    fields.push({field, token, extra: true});
  }

  return fields;
}

/** `{WORKSHOP_UIPATH_ORG_NAME: 'uipathOrgName', ...}` */
export function tokenToFieldMap(fields) {
  return Object.fromEntries(fields.map(({field, token}) => [token, field]));
}

/** The `customFields.workshop` payload for a resolved target. */
export function workshopPayload(fields, target) {
  return Object.fromEntries(fields.map(({field}) => [field, target.workshop?.[field]]));
}

/** `{'{{WORKSHOP_UIPATH_ORG_NAME}}': '<org-name>', ...}` for text substitution. */
export function tokenValueMap(fields, target) {
  return Object.fromEntries(
    fields.map(({field, token}) => [`{{${token}}}`, target.workshop?.[field] ?? '']),
  );
}
