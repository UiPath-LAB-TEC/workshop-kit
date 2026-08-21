#!/usr/bin/env node
/**
 * Reports what the kit thinks is true about the repo it is running in: kit
 * version, resolved target, declared fields, and anything that looks like drift.
 * Diagnostic only — never changes a file, never fails on a warning.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';
import {getTarget} from '../config/workshop-target.mjs';
import {readTargetsConfig, resolveFields} from '../config/workshop-fields.mjs';
import {agentsCheck} from './agents-build.mjs';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function doctor({root = process.cwd(), target: explicitTarget} = {}) {
  const kit = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8'));
  const notes = [];

  console.log(`workshop-kit  ${kit.version}`);
  console.log(`repo          ${root}`);

  let config;
  try {
    config = readTargetsConfig(root);
  } catch (error) {
    console.log(`\nconfig/workshop-targets.json could not be read: ${error.message}`);
    return 1;
  }

  console.log(`title         ${config.title ?? '(missing)'}`);
  console.log(`repo slug     ${config.repo ?? '(missing)'}`);
  if (!config.title) notes.push('config/workshop-targets.json has no "title".');
  if (!config.repo) notes.push('config/workshop-targets.json has no "repo".');

  const targetNames = Object.keys(config.targets || {});
  console.log(`targets       ${targetNames.length}: ${targetNames.join(', ')}`);
  console.log(`default       ${config.defaultTarget}`);

  try {
    const {targetName, target} = getTarget(explicitTarget);
    console.log(`resolved      ${targetName} -> ${target.siteUrl}${target.baseUrl}`);
    console.log(`tenant check  ${target.requiresTenantAccess ? 'enabled' : 'disabled'} for this target`);
  } catch (error) {
    notes.push(`target resolution failed: ${error.message}`);
  }

  try {
    const fields = resolveFields(config);
    const extras = fields.filter((entry) => entry.extra);
    console.log(`fields        ${fields.length} (${extras.length} product-specific)`);
    for (const {field, token, extra} of fields) {
      console.log(`              ${extra ? '+' : ' '} ${field} <- {{${token}}}`);
    }
  } catch (error) {
    notes.push(`field resolution failed: ${error.message}`);
  }

  // Files that should have stopped existing in a migrated repo.
  for (const stale of [
    'scripts/zip-downloads.mjs',
    'scripts/check-doc-assets.mjs',
    'scripts/check-workshop-vars.mjs',
    'scripts/workshop-target.mjs',
    'scripts/preview-target.mjs',
    'scripts/docusaurus-target.mjs',
    'scripts/uipath-codedapp-deploy.mjs',
    'scripts/check-tenant-access.mjs',
    'scripts/extract-pptx-assets.py',
    'src/css/custom.css',
    'src/pages/index.module.css',
    'AGENTS.product.md',
  ]) {
    if (existsSync(join(root, stale))) {
      notes.push(`${stale} still exists; the kit now provides it.`);
    }
  }

  // These two legitimately remain, as one-line re-exports: docs import
  // '@site/src/components/WorkshopEnv', and Docusaurus needs a real
  // src/pages/index.tsx. Only a forked copy is a problem.
  for (const [file, expected] of [
    ['src/components/WorkshopEnv.tsx', 'components/WorkshopEnv'],
    ['src/pages/index.tsx', 'components/WorkshopHome'],
  ]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    if (!content.includes(`@uipath-lab-tec/workshop-kit/${expected}`)) {
      notes.push(
        `${file} does not re-export from the kit, so it is a forked copy that will drift.`,
      );
    }
  }

  try {
    const result = agentsCheck({root});
    console.log(`AGENTS.md     ${result.ok ? 'in sync with the shared base' : 'STALE'}`);
    if (!result.ok) notes.push('AGENTS.md is stale. Run `workshop-kit agents build`.');
  } catch (error) {
    notes.push(`AGENTS.md: ${error.message}`);
  }

  if (notes.length > 0) {
    console.log(`\n${notes.length} note(s):`);
    for (const note of notes) console.log(`  - ${note}`);
  } else {
    console.log('\nNo issues found.');
  }

  return 0;
}
