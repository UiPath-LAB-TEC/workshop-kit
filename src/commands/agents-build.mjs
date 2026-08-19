#!/usr/bin/env node
/**
 * Keeps the shared "General Workshop Instructions" in every content repo's
 * AGENTS.md identical to the kit's agents/base.md.
 *
 * Coding agents read AGENTS.md from the repo root. They cannot be pointed into
 * node_modules and there is no reliable include directive, so the shared text has
 * to be physically present and committed. The compromise: one AGENTS.md per repo,
 * with the shared region inside a managed fence and the product-specific content
 * below it in the same file. `build` rewrites only what is between the markers;
 * `check` fails when they diverge.
 *
 * Scope: the repo root only. A workshop's downloads/ may contain its own
 * AGENTS.md as teaching content; that belongs to the zip pipeline and is never
 * touched here.
 *
 * A single file, rather than a generated AGENTS.md plus a hand-written
 * AGENTS.product.md, because two files that look alike invite editing the one
 * whose contents are about to be overwritten.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BEGIN = '<!-- BEGIN workshop-kit base';
const END = '<!-- END workshop-kit base -->';

function baseText() {
  return readFileSync(join(kitRoot, 'agents', 'base.md'), 'utf8').trimEnd();
}

/**
 * The marker stamps a hash of base.md's CONTENT, not the kit version.
 *
 * With the version in the marker, every kit release — including a patch that
 * never touched base.md — marked every repo's AGENTS.md stale, so CI failed on
 * each dependency bump until a regeneration commit landed. Hashing the content
 * means the marker moves only when the shared standard actually moves. Use
 * `workshop-kit doctor` to see which kit version is installed.
 */
function baseDigest() {
  return createHash('sha256').update(baseText()).digest('hex').slice(0, 8);
}

function fencedBlock() {
  const begin = `${BEGIN} @sha-${baseDigest()} — DO NOT EDIT. Run \`npm run prepare:docs\`. -->`;
  return `${begin}\n${baseText()}\n${END}`;
}

/** Trailing whitespace and final-newline differences must not fail CI. */
function normalise(text) {
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function locateFence(content, agentsPath) {
  const beginMatches = [...content.matchAll(/<!-- BEGIN workshop-kit base[^>]*-->/g)];
  const endMatches = [...content.matchAll(/<!-- END workshop-kit base -->/g)];

  if (beginMatches.length === 0 && endMatches.length === 0) return null;

  if (beginMatches.length !== 1 || endMatches.length !== 1) {
    throw new Error(
      `${agentsPath}: expected exactly one workshop-kit fence, found ${beginMatches.length} BEGIN and ${endMatches.length} END markers. Fix the markers by hand; refusing to guess which region is managed.`,
    );
  }

  const begin = beginMatches[0];
  const end = endMatches[0];
  if (end.index < begin.index) {
    throw new Error(`${agentsPath}: END marker appears before BEGIN.`);
  }

  return {start: begin.index, end: end.index + end[0].length};
}

export function agentsBuild({root = process.cwd(), write = true} = {}) {
  const agentsPath = join(root, 'AGENTS.md');
  const block = fencedBlock();

  if (!existsSync(agentsPath)) {
    throw new Error(
      `${agentsPath} does not exist. Run \`workshop-kit agents init\` to create one from the shared base.`,
    );
  }

  const current = readFileSync(agentsPath, 'utf8');
  const fence = locateFence(current, agentsPath);

  if (!fence) {
    throw new Error(
      `AGENTS.md has no workshop-kit fence markers, so there is nowhere to put the shared base. Run \`workshop-kit agents init\` to insert them above the existing content.`,
    );
  }

  const next = current.slice(0, fence.start) + block + current.slice(fence.end);
  const changed = normalise(next) !== normalise(current);

  if (write && changed) writeFileSync(agentsPath, next);
  return {changed, expected: next, actual: current, agentsPath};
}

export function agentsCheck({root = process.cwd()} = {}) {
  const {changed, expected, actual, agentsPath} = agentsBuild({root, write: false});
  if (!changed) return {ok: true};

  // Print a diff, not just "stale" — the useful question is always what drifted.
  const expectedLines = normalise(expected).split('\n');
  const actualLines = normalise(actual).split('\n');
  const diff = [];
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < max; i += 1) {
    if (expectedLines[i] !== actualLines[i]) {
      if (actualLines[i] !== undefined) diff.push(`  ${i + 1}- ${actualLines[i]}`);
      if (expectedLines[i] !== undefined) diff.push(`  ${i + 1}+ ${expectedLines[i]}`);
    }
  }

  return {ok: false, agentsPath, diff};
}

export function agentsInit({root = process.cwd()} = {}) {
  const agentsPath = join(root, 'AGENTS.md');
  const block = fencedBlock();
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';

  if (existing && locateFence(existing, agentsPath)) {
    return {created: false, message: 'AGENTS.md already has a workshop-kit fence; nothing to do.'};
  }

  if (!existing.trim()) {
    writeFileSync(
      agentsPath,
      `${block}\n\n## Project-Specific Instructions\n\n### Project Goal\n- Describe this workshop here.\n`,
    );
    return {created: true, dropped: 0, message: `Wrote ${agentsPath} from the shared base.`};
  }

  // Migrating an existing repo: everything from the first "## Project-Specific
  // Instructions" heading onward is this repo's own content and is preserved
  // verbatim. Everything above it is the old forked copy of the shared standard,
  // which base.md now supersedes, so it is dropped rather than duplicated.
  const productMatch = existing.match(/^## Project-Specific Instructions.*$/m);
  if (!productMatch) {
    throw new Error(
      `${agentsPath} has no "## Project-Specific Instructions" heading, so the shared and product-specific halves cannot be told apart. Add that heading above this repo's own content, then re-run.`,
    );
  }

  const product = existing.slice(productMatch.index).trimEnd();
  const dropped = existing.slice(0, productMatch.index).trimEnd().split('\n').length;
  writeFileSync(agentsPath, `${block}\n\n${product}\n`);

  return {
    created: true,
    dropped,
    message: `Wrote ${agentsPath}: shared base fenced above ${product.split('\n').length} lines of product content; replaced ${dropped} lines of the old forked General section.`,
  };
}
