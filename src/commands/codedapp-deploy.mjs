#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {getTarget} from '../config/workshop-target.mjs';
import {readTargetsConfig} from '../config/workshop-fields.mjs';

const root = process.cwd();

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

main();
