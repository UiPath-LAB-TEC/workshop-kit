#!/usr/bin/env node
/**
 * Wrapper around tools/extract-pptx-assets.py.
 *
 * The extractor is Python because python-pptx is the only sane way to read
 * shape geometry out of a deck, and the kit is Node. This module exists to
 * fail with a useful message instead of a Python traceback when the two
 * dependencies are missing -- which they will be, on a machine that has only
 * ever built the site.
 */
import {existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(kitRoot, 'tools', 'extract-pptx-assets.py');

const REQUIRED = [
  ['pptx', 'python-pptx'],
  ['PIL', 'Pillow'],
];

/** First interpreter that runs at all. Windows ships `python`, not `python3`. */
function findPython() {
  for (const candidate of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate;
  }
  return undefined;
}

export function extractPptx({args = []} = {}) {
  if (!existsSync(script)) {
    console.error(`Missing ${script}. This kit install is incomplete.`);
    return 1;
  }

  const python = findPython();
  if (!python) {
    console.error(
      'No Python 3 interpreter found. Install one, or set PYTHON to its path.',
    );
    return 1;
  }

  const missing = REQUIRED.filter(
    ([module]) => spawnSync(python, ['-c', `import ${module}`], {stdio: 'ignore'}).status !== 0,
  );
  if (missing.length > 0) {
    const packages = missing.map(([, pkg]) => pkg).join(' ');
    console.error(`Python packages missing: ${packages}\n`);
    console.error(`  ${python} -m pip install ${packages}\n`);
    console.error(
      'Extraction is a one-off authoring step, so these are deliberately not\n' +
        'project dependencies. A virtualenv is fine.',
    );
    return 1;
  }

  // Runs in the consumer repo, so relative --pptx / --output-root resolve
  // against the workshop the operator is standing in.
  const result = spawnSync(python, [script, ...args], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  return result.status ?? 1;
}
