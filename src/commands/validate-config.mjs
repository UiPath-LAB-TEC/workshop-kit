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
import {getTarget, readMergedTargetsConfig} from '../config/workshop-target.mjs';
import {resolveFields} from '../config/workshop-fields.mjs';

const CAPACITY_INT_KEYS = [
  'participants',
  'aiUnitsPerParticipant',
  'agentUnitsPerParticipant',
];
// Quota kinds are discovered from the tenant by `re get quotas`, so the key set
// here cannot be closed without a new product quota kind failing every build.
// The values are still checked, and check:tenant-access warns at run time about
// a kind the tenant does not report -- which is where a typo actually surfaces.
const CAPACITY_MAP_KEYS = ['ixpQuotaPerParticipant'];

/**
 * A misspelled capacity key is the failure mode worth catching here. The check
 * reads capacity with a defaults spread, so `aiUnitsPerParticipants` -- plural,
 * one character off -- falls back to 0 and silently turns the AI Unit threshold
 * off. The result is a green tenant check for a workshop that will run out of
 * units, which is the exact outcome the capacity block exists to prevent.
 */
function capacityErrors(targetName, capacity) {
  if (capacity === undefined) return [];

  if (typeof capacity !== 'object' || capacity === null || Array.isArray(capacity)) {
    return [`target "${targetName}": capacity must be an object.`];
  }

  const known = [...CAPACITY_INT_KEYS, ...CAPACITY_MAP_KEYS];
  const errors = [];
  for (const [key, raw] of Object.entries(capacity)) {
    if (CAPACITY_MAP_KEYS.includes(key)) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push(`target "${targetName}": capacity.${key} must be an object.`);
        continue;
      }
      for (const [kind, need] of Object.entries(raw)) {
        if (!Number.isInteger(need) || need < 0) {
          errors.push(
            `target "${targetName}": capacity.${key}.${kind} must be a non-negative integer, got ${JSON.stringify(need)}.`,
          );
        }
      }
      continue;
    }
    if (!CAPACITY_INT_KEYS.includes(key)) {
      errors.push(
        `target "${targetName}": unknown capacity key "${key}". Known keys: ${known.join(', ')}.`,
      );
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0) {
      errors.push(
        `target "${targetName}": capacity.${key} must be a non-negative integer, got ${JSON.stringify(raw)}.`,
      );
    }
  }
  return errors;
}

export function validateConfig({root = process.cwd()} = {}) {
  const errors = [];
  let config;

  try {
    // The overlay-merging reader, not the plain one: `config/targets/*.json`
    // holds the one-off per-delivery tenants, so validating only the main file
    // skips exactly the targets most likely to be hand-written and wrong.
    config = readMergedTargetsConfig(root);
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
    errors.push(...capacityErrors(name, config.targets[name]?.capacity));
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
