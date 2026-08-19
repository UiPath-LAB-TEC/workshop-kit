#!/usr/bin/env node
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import process from 'node:process';
import {readTargetsConfig, resolveFields} from '../config/workshop-fields.mjs';

// The consumer repo, not the kit: this file runs from inside node_modules.
const root = process.cwd();
const docsRoot = join(root, 'docs');
const targetsPath = join(root, 'config', 'workshop-targets.json');

function collectDocs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDocs(fullPath));
      continue;
    }
    if (/\.(md|mdx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineNumberFor(content, index) {
  return content.slice(0, index).split('\n').length;
}

function formatLocation(filePath, content, index) {
  return `${relative(root, filePath)}:${lineNumberFor(content, index)}`;
}

/**
 * The token map used to be recovered by regex-parsing src/components/WorkshopEnv.tsx.
 * That component now lives in the kit, and the fields a repo actually has are
 * declared in config/workshop-targets.json, so read them from there.
 */
function loadTokenMap() {
  const fields = resolveFields(readTargetsConfig(root));
  return new Map(fields.map(({field, token}) => [token, field]));
}

/**
 * WorkshopEnv now ships from the kit, so its exported component names are known
 * statically rather than scraped out of a file in the consumer repo.
 */
function parseWorkshopEnvExports() {
  return new Set([
    'WorkshopValue',
    'WorkshopLink',
    'WorkshopImage',
    'WorkshopDownloadLink',
    'WorkshopCodeBlock',
  ]);
}

const tokenToField = loadTokenMap();
const validTokens = new Set(tokenToField.keys());
const validFields = new Set(tokenToField.values());
const exportedWorkshopComponents = parseWorkshopEnvExports();
const usedTokens = new Set();
const usedFields = new Set();
const usedComponents = new Set();
const errors = [];

for (const filePath of collectDocs(docsRoot)) {
  const content = readFileSync(filePath, 'utf8');

  for (const match of content.matchAll(/\{\{(?<token>WORKSHOP_[A-Z0-9_]+)\}\}/g)) {
    const token = match.groups.token;
    if (!validTokens.has(token)) {
      errors.push(`${formatLocation(filePath, content, match.index)}: unknown workshop token {{${token}}}.`);
      continue;
    }
    usedTokens.add(token);
    usedFields.add(tokenToField.get(token));
  }

  for (const match of content.matchAll(/<Workshop(?:Value|Link)\b[^>]*\bfield=["'](?<field>[a-zA-Z0-9_]+)["']/g)) {
    const field = match.groups.field;
    if (!validFields.has(field)) {
      errors.push(`${formatLocation(filePath, content, match.index)}: unknown workshop field "${field}".`);
      continue;
    }
    usedFields.add(field);
  }

  // Accept both the kit path and the legacy @site path, so a repo mid-migration
  // is still checked rather than silently skipped.
  const importPattern =
    /import\s*{(?<imports>[^}]+)}\s*from\s*['"](?:@uipath-lab-tec\/workshop-kit\/components\/WorkshopEnv|@site\/src\/components\/WorkshopEnv)['"];?/g;
  for (const match of content.matchAll(importPattern)) {
    const importedNames = match.groups.imports
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const contentAfterImport = content.slice(match.index + match[0].length);

    for (const importedName of importedNames) {
      const localName = importedName.split(/\s+as\s+/).pop().trim();
      const componentUsagePattern = new RegExp(`<${localName}\\b`);
      if (!componentUsagePattern.test(contentAfterImport)) {
        errors.push(
          `${formatLocation(filePath, content, match.index)}: ${localName} is imported from WorkshopEnv but not used.`,
        );
        continue;
      }
      if (exportedWorkshopComponents.has(localName)) {
        usedComponents.add(localName);
      }
    }
  }
}

for (const [token, field] of tokenToField.entries()) {
  if (!usedFields.has(field)) {
    errors.push(
      `config/workshop-targets.json: workshop variable ${token} / ${field} is declared but not used in docs.`,
    );
  }
}

const targetsConfig = JSON.parse(readFileSync(targetsPath, 'utf8'));
for (const [targetName, target] of Object.entries(targetsConfig.targets || {})) {
  for (const field of validFields) {
    if (!target.workshop || !target.workshop[field]) {
      errors.push(`config/workshop-targets.json: target "${targetName}" is missing workshop.${field}.`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Workshop variable check failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Workshop variable check passed (${usedTokens.size} token reference(s), ${usedFields.size} field(s), ${usedComponents.size} WorkshopEnv component(s) checked).`,
);
