#!/usr/bin/env node
/**
 * Runs `docusaurus build|start` with WORKSHOP_TARGET pinned to a resolved target.
 *
 * Canonical source: the IXP repo, which carried the win32 fixes (a `.cmd`
 * executable shim and `shell: true` for npm/npx) that neither other repo had.
 */
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {getTarget} from '../config/workshop-target.mjs';

export function run(commandName, args, targetName) {
  const {status, error} = spawn(commandName, args, targetName);

  if (status !== 0) {
    throw new Error(
      error
        ? `${commandName} failed: ${error.message}`
        : `${commandName} exited with status ${status}`,
    );
  }
}

function spawn(commandName, args, targetName) {
  console.log(`\n> ${[commandName, ...args].join(' ')}`);
  const needsShim =
    process.platform === 'win32' && (commandName === 'npm' || commandName === 'npx');
  const executable = needsShim ? `${commandName}.cmd` : commandName;
  return spawnSync(executable, args, {
    stdio: 'inherit',
    shell: needsShim,
    env: {...process.env, WORKSHOP_TARGET: targetName},
  });
}

/**
 * Runs a step for its report only. The tenant check is advisory by contract --
 * it sets exit code 0 even with warnings -- but that contract holds only while
 * the script itself runs. A crash before its own handler is reached (an
 * unresolvable import, a missing `uip` binary, a malformed target) exits
 * non-zero, and through the throwing `run` above that would fail a build over
 * an advisory check. Deploying a workshop site must not depend on the tenant
 * being reachable, so the failure is reported and the build continues.
 */
function runAdvisory(commandName, args, targetName) {
  const {status, error} = spawn(commandName, args, targetName);
  if (status === 0) return;
  console.warn(
    `\n[tenant-access] The advisory check did not complete ` +
      (error ? `(${error.message})` : `(exit status ${status})`) +
      '. Continuing the build; verify the tenant by hand before delivery.',
  );
}

export function docusaurusTarget({command = 'build', targetArg, docusaurusArgs = []}) {
  if (!['build', 'start'].includes(command)) {
    throw new Error(`Unknown command "${command}". Use "build" or "start".`);
  }

  const {targetName, target} = getTarget(targetArg);

  run('npm', ['run', 'prepare:docs'], targetName);

  // IXP and Maestro both deleted this step outright, because neither repo had the
  // script; CA's working tree ran it unconditionally, which would make every local
  // build depend on live UiPath connectivity. Gate it on the target instead, so it
  // runs for real training tenants and never for `local`.
  if (target.requiresTenantAccess) {
    runAdvisory('npm', ['run', 'check:tenant-access'], targetName);
  }

  run('npx', ['docusaurus', command, ...docusaurusArgs], targetName);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command = 'build', targetArg, ...docusaurusArgs] = process.argv;
  docusaurusTarget({command, targetArg, docusaurusArgs});
}
