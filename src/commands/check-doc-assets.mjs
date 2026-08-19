#!/usr/bin/env node
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import process from 'node:process';

const root = process.cwd();
const docsRoot = join(root, 'docs');
const staticRoot = join(root, 'static');
const downloadsRoot = join(root, 'downloads');

const componentAssetPattern =
  /<(?<component>WorkshopImage|WorkshopDownloadLink)\b[^>]*(?<attr>src|href)=["'](?<asset>\/(?:img|downloads)\/[^"']+)["']/g;
const rawAssetAttributePattern =
  /<(?<tag>a|audio|embed|iframe|img|link|script|source|track|video)\b[^>]*(?<attr>src|href)=["'](?<asset>\/(?:img|downloads)\/[^"']+)["']/g;
const markdownAssetLinkPattern =
  /!?\[[^\]]*]\((?<asset>\/(?:img|downloads)\/[^)\s]+)(?:\s+"[^"]*")?\)/g;

const allowedComponentByPath = new Map([
  ['/img/', 'WorkshopImage'],
  ['/downloads/', 'WorkshopDownloadLink'],
]);

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

function assetExists(assetPath) {
  if (assetPath.startsWith('/img/')) {
    return existsSync(join(staticRoot, assetPath.slice(1)));
  }

  if (assetPath.startsWith('/downloads/')) {
    const staticPath = join(staticRoot, assetPath.slice(1));
    if (existsSync(staticPath)) {
      return true;
    }

    const zipMatch = assetPath.match(/^\/downloads\/([^/]+)\.zip$/);
    if (zipMatch) {
      const sourceDir = join(downloadsRoot, zipMatch[1]);
      return existsSync(sourceDir) && statSync(sourceDir).isDirectory();
    }
  }

  return false;
}

function lineNumberFor(content, index) {
  return content.slice(0, index).split('\n').length;
}

function formatLocation(filePath, content, index) {
  return `${relative(root, filePath)}:${lineNumberFor(content, index)}`;
}

const errors = [];
const checkedAssets = new Map();

for (const filePath of collectDocs(docsRoot)) {
  const content = readFileSync(filePath, 'utf8');

  for (const match of content.matchAll(componentAssetPattern)) {
    const {component, asset} = match.groups;
    const expectedComponent = [...allowedComponentByPath.entries()].find(([prefix]) =>
      asset.startsWith(prefix),
    )?.[1];

    if (expectedComponent && component !== expectedComponent) {
      errors.push(
        `${formatLocation(filePath, content, match.index)}: ${asset} should use ${expectedComponent}, not ${component}.`,
      );
    }

    checkedAssets.set(asset, {
      location: formatLocation(filePath, content, match.index),
      kind: component,
    });
  }

  for (const match of content.matchAll(rawAssetAttributePattern)) {
    errors.push(
      `${formatLocation(filePath, content, match.index)}: raw ${match.groups.attr}="${match.groups.asset}" is not base-path-safe; use WorkshopImage or WorkshopDownloadLink.`,
    );
  }

  for (const match of content.matchAll(markdownAssetLinkPattern)) {
    errors.push(
      `${formatLocation(filePath, content, match.index)}: markdown asset link ${match.groups.asset} is not base-path-safe; use WorkshopImage or WorkshopDownloadLink.`,
    );
  }
}

for (const [asset, {location, kind}] of checkedAssets.entries()) {
  if (!assetExists(asset)) {
    errors.push(`${location}: ${kind} target ${asset} does not exist in static/ or downloads/.`);
  }
}

if (errors.length > 0) {
  console.error(`Doc asset check failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Doc asset check passed (${checkedAssets.size} asset reference(s) checked).`);
