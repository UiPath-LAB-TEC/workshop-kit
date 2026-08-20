#!/usr/bin/env node
/**
 * Validates config/workshop-targets.json.
 *
 * Deliberately not a JSON Schema run: the schema is for editor autocomplete,
 * while this asserts the invariants the code actually relies on, across EVERY
 * target rather than only the default one. A one-off training target that is
 * missing a field is otherwise fine until the day someone builds with it.
 */
import process from 'node:process';
import {getTarget} from '../config/workshop-target.mjs';
import {readTargetsConfig, resolveFields} from '../config/workshop-fields.mjs';

export function validateConfig({root = process.cwd()} = {}) {
  const errors = [];
  let config;

  try {
    config = readTargetsConfig(root);
  } catch (error) {
    console.error(`config/workshop-targets.json could not be read: ${error.message}`);
    return 1;
  }

  for (const key of ['title', 'tagline', 'repo', 'defaultTarget']) {
    if (!String(config[key] ?? '').trim()) errors.push(`missing top-level "${key}".`);
  }

  if (config.repo && !/^[^/\s]+\/[^/\s]+$/.test(config.repo)) {
    errors.push(`"repo" must be "<org>/<repo>", got "${config.repo}".`);
  }

  const targetNames = Object.keys(config.targets || {});
  if (targetNames.length === 0) errors.push('no targets defined.');

  if (config.defaultTarget && !targetNames.includes(config.defaultTarget)) {
    errors.push(`defaultTarget "${config.defaultTarget}" is not among: ${targetNames.join(', ')}.`);
  }

  let fields = [];
  try {
    fields = resolveFields(config);
  } catch (error) {
    errors.push(error.message);
  }

  // Every target, not just the default. getTarget() runs the same validation the
  // build does, so a target that would fail at build time fails here instead.
  for (const name of targetNames) {
    try {
      getTarget(name);
    } catch (error) {
      errors.push(`target "${name}": ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`Config check failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }

  console.log(
    `Config check passed (${targetNames.length} target(s), ${fields.length} field(s): ${targetNames.join(', ')}).`,
  );
  return 0;
}
