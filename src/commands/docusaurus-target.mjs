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
  console.log(`\n> ${[commandName, ...args].join(' ')}`);
  const needsShim =
    process.platform === 'win32' && (commandName === 'npm' || commandName === 'npx');
  const executable = needsShim ? `${commandName}.cmd` : commandName;
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    shell: needsShim,
    env: {...process.env, WORKSHOP_TARGET: targetName},
  });

  if (result.status !== 0) {
    throw new Error(
      result.error
        ? `${commandName} failed: ${result.error.message}`
        : `${commandName} exited with status ${result.status}`,
    );
  }
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
    run('npm', ['run', 'check:tenant-access'], targetName);
  }

  run('npx', ['docusaurus', command, ...docusaurusArgs], targetName);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command = 'build', targetArg, ...docusaurusArgs] = process.argv;
  docusaurusTarget({command, targetArg, docusaurusArgs});
}
