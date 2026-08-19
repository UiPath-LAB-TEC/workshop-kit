#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const configPath = path.join(root, 'config', 'workshop-targets.json');

function readTargetsConfig() {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
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
  validateTarget(targetName, target);
  return {targetName, target};
}

function validateTarget(targetName, target) {
  const required = [
    ['siteUrl', target.siteUrl],
    ['baseUrl', target.baseUrl],
    ['workshop.uipathOrgName', target.workshop?.uipathOrgName],
    ['workshop.uipathTenantName', target.workshop?.uipathTenantName],
    ['workshop.uipathTenantUrl', target.workshop?.uipathTenantUrl],
    ['workshop.orchestratorParentFolder', target.workshop?.orchestratorParentFolder],
    ['codedApp.name', target.codedApp?.name],
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
