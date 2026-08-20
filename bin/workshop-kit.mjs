#!/usr/bin/env node
/**
 * Single CLI entry point. Every command operates on the repo in process.cwd(),
 * never on the kit's own directory — it runs from inside node_modules.
 */
import {spawnSync} from 'node:child_process';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const commandsDir = join(kitRoot, 'src', 'commands');

const USAGE = `workshop-kit <command>

  prepare                      zip:downloads, doc-asset and workshop-var checks, agents build
  agents <build|check|init>    manage the shared region of AGENTS.md
  zip-downloads                package downloads/<name>/ into static/downloads/<name>.zip
  check:doc-assets             verify every asset referenced by docs exists
  check:workshop-vars          verify workshop tokens, fields and components line up
  check:tenant-access          advisory tenant permission report (never fails a build)
  build [<target>]             docusaurus build with WORKSHOP_TARGET pinned
  start [<target>]             docusaurus start with WORKSHOP_TARGET pinned
  preview [<target>] [<port>]  serve build/ at the target's baseUrl
  codedapp <check|pack|publish|deploy|all>
  pulse                        tenant pulse dashboard
  validate-config              check every target in config/workshop-targets.json
  doctor [target]              report kit version, resolved target and drift
  init --product <slug> [--title <t>]   scaffold a new workshop repo

  --help, --version
`;

/** Run one of the kit's own scripts as a child process, in the consumer's cwd. */
function runScript(relativePath, args = []) {
  const result = spawnSync(process.execPath, [join(kitRoot, relativePath), ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  return result.status ?? 1;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

/**
 * Target from either `--target <name>` or a bare leading positional, because the
 * repos' existing scripts are invoked as `npm run build:target -- local`.
 * Docusaurus flags always start with `-`, so a leading bare word is the target.
 */
function takeTarget(args) {
  const flag = takeFlag(args, '--target');
  if (flag) return flag;
  if (args.length > 0 && !args[0].startsWith('-')) return args.shift();
  return undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command === '--version' || command === '-v') {
    const {readFileSync} = await import('node:fs');
    const pkg = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8'));
    console.log(pkg.version);
    return 0;
  }

  switch (command) {
    case 'zip-downloads':
      return runScript('src/commands/zip-downloads.mjs', argv);

    case 'check:doc-assets':
      return runScript('src/commands/check-doc-assets.mjs', argv);

    case 'check:workshop-vars':
      return runScript('src/commands/check-workshop-vars.mjs', argv);

    case 'check:tenant-access':
      return runScript('src/commands/check-tenant-access.mjs', argv);

    case 'prepare': {
      for (const step of [
        'src/commands/zip-downloads.mjs',
        'src/commands/check-doc-assets.mjs',
        'src/commands/check-workshop-vars.mjs',
      ]) {
        const status = runScript(step, []);
        if (status !== 0) return status;
      }
      const {agentsBuild} = await import(join(commandsDir, 'agents-build.mjs'));
      const {changed, agentsPath} = agentsBuild({});
      console.log(changed ? `Updated ${agentsPath} from the shared base.` : 'AGENTS.md already in sync.');
      return 0;
    }

    case 'agents': {
      const sub = argv.shift() || 'build';
      const module = await import(join(commandsDir, 'agents-build.mjs'));

      if (sub === 'build') {
        const {changed, agentsPath} = module.agentsBuild({});
        console.log(changed ? `Updated ${agentsPath} from the shared base.` : 'AGENTS.md already in sync.');
        return 0;
      }
      if (sub === 'check') {
        const result = module.agentsCheck({});
        if (result.ok) {
          console.log('AGENTS.md is in sync with the shared base.');
          return 0;
        }
        console.error(`${result.agentsPath} does not match the shared base:\n`);
        console.error(result.diff.join('\n'));
        console.error('\nRun `workshop-kit agents build` (or `npm run prepare:docs`).');
        return 1;
      }
      if (sub === 'init') {
        console.log(module.agentsInit({}).message);
        return 0;
      }
      console.error(`Unknown "agents" subcommand "${sub}". Use build, check or init.`);
      return 1;
    }

    case 'build':
    case 'start': {
      const target = takeTarget(argv);
      const {docusaurusTarget} = await import(join(commandsDir, 'docusaurus-target.mjs'));
      docusaurusTarget({command, targetArg: target, docusaurusArgs: argv});
      return 0;
    }

    case 'preview': {
      const target = takeTarget(argv);
      return runScript(
        'src/commands/preview-target.mjs',
        target ? [target, ...argv] : argv,
      );
    }

    case 'codedapp': {
      const sub = argv.shift();
      if (!sub) {
        console.error('codedapp needs a subcommand: check, pack, publish, deploy or all.');
        return 1;
      }
      return runScript('src/commands/codedapp-deploy.mjs', [sub, ...argv]);
    }

    case 'pulse':
      return runScript('tools/tenant-pulse-dashboard/server.mjs', argv);

    case 'validate-config': {
      const {validateConfig} = await import(join(commandsDir, 'validate-config.mjs'));
      return validateConfig({});
    }

    case 'doctor': {
      // Accepts a target the same way build/start/preview do. Without this it
      // silently reported the default target while the caller believed they
      // were inspecting the one they named.
      const target = takeTarget(argv);
      const {doctor} = await import(join(commandsDir, 'doctor.mjs'));
      return doctor({target});
    }

    case 'init': {
      const {init} = await import(join(commandsDir, 'init.mjs'));
      return init({product: takeFlag(argv, '--product'), title: takeFlag(argv, '--title')});
    }

    default:
      console.error(`Unknown command "${command}".\n`);
      process.stdout.write(USAGE);
      return 1;
  }
}

main()
  .then((status) => process.exit(status ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
