#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {getTarget} from '../config/workshop-target.mjs';
import {readTargetsConfig} from '../config/workshop-fields.mjs';

const root = process.cwd();
// Enough to roll back to the previously deployed build without keeping
// every pack ever run. Override with UIPATH_CODEDAPP_KEEP.
const DEFAULT_KEEP = 3;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue = ''] = match;
    if (process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = rawValue.replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required deploy environment variable: ${name}`);
  }
  return value;
}

/**
 * Title for the coded-app description fallback. Read from
 * config/workshop-targets.json so it has exactly one home, shared with
 * docusaurus.config.ts, instead of being hardcoded per repo.
 */
function siteTitle() {
  try {
    return readTargetsConfig(root).title || 'UiPath Workshop';
  } catch {
    return 'UiPath Workshop';
  }
}

function run(command, args, options = {}) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const executable = process.platform === 'win32' && (command === 'uip' || command === 'npm')
    ? `${command}.cmd`
    : command;
  const result = spawnSync(executable, args, {
    cwd: root,
    shell: process.platform === 'win32' && (command === 'uip' || command === 'npm'),
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: {...process.env, WORKSHOP_TARGET: options.targetName || process.env.WORKSHOP_TARGET},
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    throw new Error(result.error ? `${command} failed: ${result.error.message}` : `${command} exited with status ${result.status}`);
  }

  return result.stdout;
}

function generatedVersion() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `0.1.0-${stamp}`;
}

/**
 * `<name>.<version>.nupkg`. The name may contain dots, so the version is
 * anchored as the trailing semver rather than assumed to start at the first
 * dot. A file that does not match this shape is not ours to reason about, and
 * is never deleted.
 */
function parsePackageFilename(filename) {
  const match = filename.match(/^(.*)\.(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.nupkg$/);
  return match ? {name: match[1], version: match[2]} : undefined;
}

/**
 * `uip codedapp pack` writes a fresh timestamped nupkg on every run and never
 * removes one. Two months of packing left 147 MB across 21 files in one repo.
 *
 * Pruning is per package NAME, not across the directory. One repo packs a
 * different app name per training target, so a global "keep the newest 3"
 * would delete an older target's only package the moment you pack a different
 * one -- and `publish` is a separate command that runs against the local file,
 * so that breaks pack-now-publish-later. Grouping by name also guarantees the
 * file the current invocation just produced survives, since it is the newest
 * in its own group.
 */
export function prunePackages() {
  const dir = path.join(root, '.uipath');
  if (!fs.existsSync(dir)) return;

  const raw = process.env.UIPATH_CODEDAPP_KEEP?.trim();
  let keep = DEFAULT_KEEP;
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      console.warn(`UIPATH_CODEDAPP_KEEP="${raw}" is not a positive integer; keeping ${DEFAULT_KEEP}.`);
    } else {
      keep = parsed;
    }
  }

  const groups = new Map();
  for (const filename of fs.readdirSync(dir)) {
    const parsed = parsePackageFilename(filename);
    if (!parsed) continue;
    const full = path.join(dir, filename);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (!groups.has(parsed.name)) groups.set(parsed.name, []);
    groups.get(parsed.name).push({filename, full, mtimeMs});
  }

  let removed = 0;
  let bytes = 0;
  for (const [name, files] of groups) {
    if (files.length <= keep) continue;
    // Newest first. Versions are timestamps, so the filename is a sound
    // tiebreak when two packs land in the same millisecond.
    files.sort((a, b) => b.mtimeMs - a.mtimeMs || b.filename.localeCompare(a.filename));
    for (const file of files.slice(keep)) {
      try {
        bytes += fs.statSync(file.full).size;
        fs.unlinkSync(file.full);
        removed += 1;
      } catch (error) {
        console.warn(`Could not remove ${file.filename}: ${error.message}`);
      }
    }
    console.log(`Pruned ${files.length - keep} old package(s) for "${name}", kept the newest ${keep}.`);
  }

  if (removed > 0) {
    console.log(`Freed ${(bytes / 1024 / 1024).toFixed(1)} MB from .uipath/.`);
  }
}

function targetAppUrl(target) {
  return new URL(target.baseUrl.replace(/^\//, ''), `${target.siteUrl}/`).toString().replace(/\/$/, '');
}

function readAppUrl(target) {
  const appConfigPath = path.join(root, '.uipath', 'app.config.json');
  if (!fs.existsSync(appConfigPath)) {
    return targetAppUrl(target);
  }

  const config = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  return config.appUrl || targetAppUrl(target);
}

function main() {
  const [, , command = 'check', targetArg] = process.argv;
  const {targetName, target} = getTarget(targetArg);
  const deployEnvPath = path.join(root, `.env.deploy.${targetName}`);

  loadEnvFile(deployEnvPath);

  const packageName = target.codedApp.name;
  const packageVersion = process.env.UIPATH_CODEDAPP_VERSION?.trim() || generatedVersion();
  const author = process.env.UIPATH_CODEDAPP_AUTHOR?.trim() || 'UiPath LAB TEC';
  // Was hardcoded per repo. The site title comes from docusaurus.config.ts via the
  // factory, so the fallback is derived rather than forked.
  const description =
    target.codedApp.description || `${siteTitle()} (${targetName})`;

  if (command === 'check') {
    console.log(`Target: ${targetName}`);
    console.log(`UiPath tenant URL: ${target.workshop.uipathTenantUrl}`);
    console.log(`Coded App name: ${packageName}`);
    console.log(`Docusaurus baseUrl: ${target.baseUrl}`);
    console.log(`Deploy env file: ${deployEnvPath}`);
    console.log(`Folder key present: ${Boolean(process.env.UIPATH_FOLDER_KEY?.trim())}`);
    return;
  }

  if (command === 'pack') {
    run('npm', ['run', 'build:target', '--', targetName], {targetName});
    run('uip', [
      'codedapp',
      'pack',
      'build',
      '-n',
      packageName,
      '--version',
      packageVersion,
      '--author',
      author,
      '--description',
      description,
    ]);
    prunePackages();
    return;
  }

  if (command === 'publish') {
    run('uip', ['codedapp', 'publish', '-n', packageName, '--version', packageVersion]);
    return;
  }

  if (command === 'deploy') {
    const folderKey = requireEnv('UIPATH_FOLDER_KEY');
    run('uip', ['codedapp', 'deploy', '-n', packageName, '--folder-key', folderKey]);
    const appUrl = readAppUrl(target);
    if (appUrl) {
      console.log(`\nApp URL: ${appUrl}`);
    }
    return;
  }

  if (command === 'all') {
    run('uip', ['login', 'status', '--output', 'json']);
    run('npm', ['run', 'build:target', '--', targetName], {targetName});
    run('uip', [
      'codedapp',
      'pack',
      'build',
      '-n',
      packageName,
      '--version',
      packageVersion,
      '--author',
      author,
      '--description',
      description,
    ]);
    prunePackages();
    run('uip', ['codedapp', 'publish', '-n', packageName, '--version', packageVersion]);
    const folderKey = requireEnv('UIPATH_FOLDER_KEY');
    run('uip', ['codedapp', 'deploy', '-n', packageName, '--folder-key', folderKey]);
    const appUrl = readAppUrl(target);
    if (appUrl) {
      run('curl', ['-sS', '-L', appUrl], {capture: true});
      console.log(`\nApp URL: ${appUrl}`);
    }
    return;
  }

  throw new Error(`Unknown command "${command}". Use check, pack, publish, deploy, or all.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
