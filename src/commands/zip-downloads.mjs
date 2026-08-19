#!/usr/bin/env node
/**
 * Packages each `downloads/<name>/` directory into `static/downloads/<name>.zip`.
 *
 * THREE-WAY MERGE. Two improvements evolved in parallel and neither repo had both:
 *
 *  - coding-agents-workshop staged each folder into a temp dir and substituted
 *    {{WORKSHOP_*}} tokens into the staged AGENTS.md before zipping. Without it,
 *    participants receive a project file full of literal placeholders.
 *  - the IXP repo added a PowerShell `Compress-Archive` fallback so the pipeline
 *    works on Windows, where `zip` is usually absent.
 *
 * This version has both: CA's staging and token rendering, IXP's platform-aware
 * command selection.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import process from 'node:process';
import {getTarget} from '../config/workshop-target.mjs';
import {readTargetsConfig, resolveFields, tokenValueMap} from '../config/workshop-fields.mjs';

// The consumer repo, not the kit: this file runs from inside node_modules.
const projectRoot = process.cwd();
const downloadsRoot = join(projectRoot, 'downloads');
const staticDownloadsRoot = join(projectRoot, 'static', 'downloads');

const {targetName, target} = getTarget();
// Derived from config/workshop-targets.json, so a repo that declares an extra
// field gets its token rendered into participant files with no code change here.
const workshopTokens = tokenValueMap(resolveFields(readTargetsConfig(projectRoot)), target);

function renderWorkshopTemplate(filePath) {
  if (!existsSync(filePath)) return;

  let content = readFileSync(filePath, 'utf8');
  for (const [token, value] of Object.entries(workshopTokens)) {
    content = content.split(token).join(value);
  }
  writeFileSync(filePath, content);
}

/** Platform-aware archive command. From the IXP repo. */
function archiveCommand(zipPath) {
  if (process.platform !== 'win32') {
    return {command: 'zip', args: ['-r', zipPath, '.']};
  }
  return {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-Command',
      `Get-ChildItem -Force | Compress-Archive -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
  };
}

if (!existsSync(downloadsRoot)) {
  console.log('No downloads directory found. Skipping ZIP generation.');
  process.exit(0);
}

mkdirSync(staticDownloadsRoot, {recursive: true});

const entries = readdirSync(downloadsRoot, {withFileTypes: true});
const downloadFolders = entries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// Only directories are packaged. A loose file at the downloads/ root used to be
// skipped in total silence, which is why one workshop shipped no ZIPs at all
// without anyone noticing. Say so, but do not fail the build.
const looseFiles = entries
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();
for (const name of looseFiles) {
  console.warn(
    `Warning: downloads/${name} is not inside a directory, so it was not packaged into any ZIP. Move it to downloads/<name>/ to ship it.`,
  );
}

if (downloadFolders.length === 0) {
  console.log('No download folders found. Skipping ZIP generation.');
  process.exit(0);
}

for (const folderName of downloadFolders) {
  const sourceDir = join(downloadsRoot, folderName);
  const zipPath = join(staticDownloadsRoot, `${folderName}.zip`);
  const stagingRoot = mkdtempSync(join(tmpdir(), 'workshop-download-'));
  const stagedSourceDir = join(stagingRoot, folderName);

  rmSync(zipPath, {force: true});
  cpSync(sourceDir, stagedSourceDir, {recursive: true});
  // Workshop CONTENT, not infrastructure: participants download a project
  // repository which itself contains an agent file, because these workshops teach
  // coding agents. Unrelated to the repo-root AGENTS.md that `agents build`
  // manages, and this only ever rewrites the staged copy, never the source.
  renderWorkshopTemplate(join(stagedSourceDir, 'AGENTS.md'));

  const {command, args} = archiveCommand(zipPath);
  const result = spawnSync(command, args, {
    cwd: stagedSourceDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  rmSync(stagingRoot, {recursive: true, force: true});

  if (result.status !== 0) {
    console.error(`Failed to create ${basename(zipPath)}.`);
    if (result.error) console.error(result.error.message);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }

  console.log(`Created static/downloads/${basename(zipPath)} for target "${targetName}"`);
}
