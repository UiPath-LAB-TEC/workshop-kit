#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {resolveFields} from './workshop-fields.mjs';

// `uip codedapp deploy` refuses a longer name. `publish` does NOT -- it accepts the
// name, creates the package, and only deploy rejects it, leaving an orphan package
// in Orchestrator. So this is asserted here, in validateTarget, which every command
// path reaches before any of them talks to a tenant.
const CODED_APP_NAME_LIMIT = 32;

/**
 * Normalises a tenant name into a name fragment: lowercase, underscores and any
 * other separator collapsed to single hyphens, no leading or trailing hyphen.
 * `Bellevue_July2026_20260727` -> `bellevue-july2026-20260727`.
 */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * `<productSlug>-<tenant>`, used when a target omits codedApp.name.
 *
 * Derived rather than stored so the name cannot drift between the build and the
 * deploy. baseUrl is compiled into the static output by Docusaurus, and the app is
 * served at /<name>/, so a build and a deploy that disagree produce a site whose
 * every asset 404s. Both paths call getTarget(), so both see this one value.
 *
 * A target may still set codedApp.name explicitly, which wins. That is the escape
 * hatch for tenants whose names are too long to fit the 32-character limit once
 * the product slug is prepended -- deliberately an override rather than automatic
 * truncation, because truncating collides: two tenants differing only in a date
 * suffix truncate to the same name and would silently overwrite each other's app.
 */
function deriveCodedAppName(config, target) {
  const productSlug = config.productSlug;
  const tenant = target.workshop?.uipathTenantName;
  if (!productSlug || !tenant) return undefined;
  return `${slugify(productSlug)}-${slugify(tenant)}`;
}

// The consumer repo, not the kit: this file runs from inside node_modules.
const root = process.cwd();
const configPath = path.join(root, 'config', 'workshop-targets.json');
const targetOverlayDir = path.join(root, 'config', 'targets');

/**
 * Reads config/workshop-targets.json, then merges any config/targets/<name>.json
 * overlay files in as additional targets. Ephemeral one-off training tenants can
 * live in their own file and be pruned without touching the main config.
 */
function readTargetsConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (!fs.existsSync(targetOverlayDir)) return config;

  config.targets = config.targets || {};
  for (const entry of fs.readdirSync(targetOverlayDir).sort()) {
    if (!entry.endsWith('.json')) continue;
    const name = entry.slice(0, -'.json'.length);
    if (config.targets[name]) {
      throw new Error(
        `Target "${name}" is defined both in config/workshop-targets.json and config/targets/${entry}.`,
      );
    }
    config.targets[name] = JSON.parse(
      fs.readFileSync(path.join(targetOverlayDir, entry), 'utf8'),
    );
  }

  return config;
}

export function getTargetName(explicitTarget) {
  const config = readTargetsConfig();
  return explicitTarget || process.env.WORKSHOP_TARGET || config.defaultTarget || 'local';
}

export function getTarget(explicitTarget) {
  const config = readTargetsConfig();
  const targetName = getTargetName(explicitTarget);
  const target = config.targets?.[targetName];
  if (!target) {
    const known = Object.keys(config.targets || {}).join(', ');
    throw new Error(`Unknown workshop target "${targetName}". Known targets: ${known}`);
  }
  const resolved = resolveCodedAppName(config, target);
  validateTarget(targetName, resolved, config);
  assertUniqueAppNames(config);
  return {targetName, target: resolved};
}

/**
 * No two targets may resolve to the same codedApp.name.
 *
 * Derivation makes this reachable in a way stored names never were. `local` and
 * `growth` legitimately point at the SAME tenant -- the difference between them is
 * how the site is served, not which tenant it talks to -- so if both omit
 * codedApp.name they derive an identical name and one deploy silently replaces the
 * other's app. Per-target validation cannot see that; only a config-wide check can.
 */
function assertUniqueAppNames(config) {
  const byName = new Map();
  for (const [name, target] of Object.entries(config.targets || {})) {
    const appName = resolveCodedAppName(config, target).codedApp?.name;
    if (!appName) continue;
    if (!byName.has(appName)) byName.set(appName, []);
    byName.get(appName).push(name);
  }

  for (const [appName, targets] of byName) {
    if (targets.length < 2) continue;
    throw new Error(
      `Targets ${targets.map((t) => `"${t}"`).join(' and ')} both resolve to codedApp.name ` +
        `"${appName}", so deploying one would replace the other's app. Targets that share a ` +
        `tenant need an explicit codedApp.name to tell them apart.`,
    );
  }
}

/**
 * Returns the target with codedApp.name filled in from productSlug + tenant when
 * the target does not set one. Never mutates the parsed config.
 */
function resolveCodedAppName(config, target) {
  if (target.codedApp?.name) return target;

  const derived = deriveCodedAppName(config, target);
  if (!derived) return target;

  return {...target, codedApp: {...target.codedApp, name: derived}};
}

function validateTarget(targetName, target, config) {
  const required = [
    ['siteUrl', target.siteUrl],
    ['baseUrl', target.baseUrl],
    ['codedApp.name', target.codedApp?.name],
    // Base fields plus whatever this repo declares in extraFields, so a
    // product-specific field is validated the same as a shared one.
    ...resolveFields(config).map(({field}) => [
      `workshop.${field}`,
      target.workshop?.[field],
    ]),
  ];

  const missing = required.filter(([, value]) => !String(value || '').trim());
  if (missing.length > 0) {
    throw new Error(
      `Target "${targetName}" is missing required fields: ${missing
        .map(([name]) => name)
        .join(', ')}`,
    );
  }

  if (!target.baseUrl.startsWith('/') || !target.baseUrl.endsWith('/')) {
    throw new Error(`Target "${targetName}" baseUrl must start and end with "/".`);
  }

  const appName = target.codedApp.name;
  if (appName.length > CODED_APP_NAME_LIMIT) {
    const derived = deriveCodedAppName(config, target) === appName;
    throw new Error(
      `Target "${targetName}" codedApp.name is ${appName.length} characters; the limit is ` +
        `${CODED_APP_NAME_LIMIT}: "${appName}".\n` +
        (derived
          ? `  This name was derived from productSlug + workshop.uipathTenantName. Set an ` +
            `explicit codedApp.name on the "${targetName}" target to override it. It is not ` +
            `truncated automatically: two tenants differing only by a date suffix would ` +
            `truncate to the same name and overwrite each other's app.`
          : `  Shorten the product slug rather than the prefix, which is what participants ` +
            `recognise across workshops.`),
    );
  }
}

function printTarget(targetName, target) {
  console.log(JSON.stringify({targetName, ...target}, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command = 'show', targetArg] = process.argv;
  const {targetName, target} = getTarget(targetArg);

  if (command === 'show' || command === 'check') {
    printTarget(targetName, target);
  } else {
    throw new Error(`Unknown command "${command}". Use "show" or "check".`);
  }
}
