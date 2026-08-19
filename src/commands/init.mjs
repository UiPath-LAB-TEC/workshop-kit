#!/usr/bin/env node
/**
 * Scaffolds a new workshop repo from template/.
 *
 * Deliberately minimal for now: the template is only partially populated, and
 * fleshing it out is its own migration stage. It refuses rather than producing a
 * repo that looks complete and is not.
 */
import {existsSync, readdirSync, cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const templateDir = join(kitRoot, 'template');

const REQUIRED_TEMPLATE_FILES = [
  'package.json',
  'docusaurus.config.ts',
  'sidebars.ts',
  'config/workshop-targets.json',
];

export function init({product, root = process.cwd()} = {}) {
  if (!product) {
    console.error('init needs --product <slug>, e.g. `workshop-kit init --product maestro`.');
    return 1;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(product)) {
    console.error(`"${product}" is not a valid slug; use lowercase letters, digits and hyphens.`);
    return 1;
  }

  const missing = REQUIRED_TEMPLATE_FILES.filter(
    (file) => !existsSync(join(templateDir, file)),
  );
  if (missing.length > 0) {
    console.error(
      `The scaffold is not complete yet, so \`init\` would produce a repo that does not build.\n` +
        `Missing from template/: ${missing.join(', ')}\n\n` +
        `Present today: ${readdirSync(templateDir).join(', ')}\n` +
        `Populating the template is a separate step; until then, copy an existing workshop repo.`,
    );
    return 1;
  }

  const dest = join(root, `workshop-${product}`);
  if (existsSync(dest)) {
    console.error(`${dest} already exists.`);
    return 1;
  }

  mkdirSync(dest, {recursive: true});
  cpSync(templateDir, dest, {recursive: true});

  // .gitignore is stored unprefixed so it does not apply to the kit's own repo.
  const gitignore = join(dest, 'gitignore');
  if (existsSync(gitignore)) {
    writeFileSync(join(dest, '.gitignore'), readFileSync(gitignore, 'utf8'));
  }

  console.log(`Scaffolded ${dest}. Next: set title, tagline and repo in config/workshop-targets.json.`);
  return 0;
}
