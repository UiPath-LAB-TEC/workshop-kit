#!/usr/bin/env node
/**
 * Moves this repo onto a different released kit tag, then proves it worked.
 *
 * The reason this is a command rather than a note in a README: `npm install`
 * alone does NOT perform the repin. package-lock.json records the resolved
 * COMMIT of the previous tag, so npm honours the lock and keeps the old kit
 * even though package.json now names a new tag. The install succeeds, prints
 * "changed 1 package", and leaves you on the old version. Nothing fails.
 *
 * That silent no-op shipped a "repinned" commit in one repo during the v1.2.0
 * rollout and was only caught by running `workshop-kit --version` by hand. So
 * this command forces re-resolution with an explicit spec, and then asserts the
 * installed version is the one that was asked for. If that assertion ever
 * fails, stop and read it — it means npm resolved something other than the tag.
 *
 * Regenerating AGENTS.md is part of the same operation, not a follow-up: a kit
 * release that changes agents/base.md moves the fence hash, so a repin without
 * it leaves `agents check` failing in a repo that otherwise looks fine.
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import process from 'node:process';

const PKG = '@uipath-lab-tec/workshop-kit';
const REPO = 'UiPath-LAB-TEC/workshop-kit';

function run(cmd, args, {cwd, quiet = false} = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return {status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? ''};
}

function installedVersion(root) {
  try {
    const path = join(root, 'node_modules', PKG, 'package.json');
    return JSON.parse(readFileSync(path, 'utf8')).version;
  } catch {
    return undefined;
  }
}

/** `v1.2.0` -> `1.2.0`, so it can be compared with the installed version. */
function versionFromTag(tag) {
  return /^v\d/.test(tag) ? tag.slice(1) : undefined;
}

export function repin({tag, root = process.cwd(), skipChecks = false} = {}) {
  if (!tag) {
    console.error('repin needs a tag, e.g. `workshop-kit repin v1.2.0`.');
    return 1;
  }

  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath) || !existsSync(join(root, 'config', 'workshop-targets.json'))) {
    console.error(
      'This does not look like a workshop repo (no package.json + config/workshop-targets.json).\n' +
        'Run repin from inside a content repo.',
    );
    return 1;
  }

  const spec = `github:${REPO}#${tag}`;

  // Fail before touching anything if the tag does not exist. Otherwise npm's
  // error arrives after package.json has already been rewritten.
  const remote = run('git', ['ls-remote', '--exit-code', '--tags', `https://github.com/${REPO}.git`, tag], {
    quiet: true,
  });
  if (remote.status !== 0) {
    console.error(`Tag "${tag}" is not on the ${REPO} remote. Push it before repinning.`);
    return 1;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const before = pkg.dependencies?.[PKG];
  if (!before) {
    console.error(`${PKG} is not a dependency of this repo.`);
    return 1;
  }

  console.log(`${pkg.name}`);
  console.log(`  from  ${before}`);
  console.log(`  to    ${spec}`);

  pkg.dependencies[PKG] = spec;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  // The explicit `npm install <pkg>@<spec>` form is what forces npm to
  // re-resolve. A bare `npm install` here would be the silent no-op.
  console.log('\n> forcing re-resolution');
  if (run('npm', ['install', `${PKG}@${spec}`, '--no-audit', '--no-fund'], {cwd: root}).status !== 0) {
    console.error('\nnpm install failed. package.json has been updated; fix the install and re-run.');
    return 1;
  }

  const installed = installedVersion(root);
  const expected = versionFromTag(tag);
  if (!installed) {
    console.error(`\n${PKG} is not present in node_modules after install.`);
    return 1;
  }
  if (expected && installed !== expected) {
    console.error(
      `\nRepin did not take: expected ${expected} from ${tag}, but ${installed} is installed.\n` +
        'npm resolved something other than the tag. Delete package-lock.json and node_modules, then retry.',
    );
    return 1;
  }
  console.log(`  installed ${installed}`);

  // A base.md change moves the fence hash, so this is part of the repin.
  console.log('\n> regenerating AGENTS.md');
  if (run('node', [join(root, 'node_modules', PKG, 'bin', 'workshop-kit.mjs'), 'agents', 'build'], {
    cwd: root,
  }).status !== 0) {
    console.error('\nagents build failed.');
    return 1;
  }

  if (skipChecks) {
    console.log('\nSkipped verification (--no-verify). Run `npm run build` before committing.');
  } else {
    console.log('\n> verifying');
    const kitBin = join(root, 'node_modules', PKG, 'bin', 'workshop-kit.mjs');
    for (const [label, cmd, args] of [
      ['agents check', 'node', [kitBin, 'agents', 'check']],
      ['validate-config', 'node', [kitBin, 'validate-config']],
      ['typecheck', 'npm', ['run', 'typecheck', '--silent']],
      ['build', 'npm', ['run', 'build', '--silent']],
    ]) {
      const {status} = run(cmd, args, {cwd: root, quiet: true});
      console.log(`  ${status === 0 ? 'pass' : 'FAIL'}  ${label}`);
      if (status !== 0) {
        console.error(`\n${label} failed on ${tag}. Re-run it directly to see the output.`);
        return 1;
      }
    }
  }

  console.log(`\nRepinned to ${tag}. Commit package.json, package-lock.json and AGENTS.md together —`);
  console.log('a repin without the regenerated AGENTS.md leaves `agents check` failing.');
  return 0;
}

export default repin;
