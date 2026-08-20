#!/usr/bin/env node
// tsc does not copy non-TS assets, so the components' CSS module has to be moved
// into dist alongside the JS that imports it.
import {cpSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = ['components/WorkshopHome.module.css'];

for (const rel of assets) {
  const to = join(root, 'dist', rel);
  mkdirSync(dirname(to), {recursive: true});
  cpSync(join(root, 'src', rel), to);
  console.log(`copied ${rel} -> dist/${rel}`);
}
