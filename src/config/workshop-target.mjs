#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {resolveFields} from './workshop-fields.mjs';

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
  validateTarget(targetName, target, config);
  return {targetName, target};
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
