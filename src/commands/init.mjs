#!/usr/bin/env node
/**
 * Scaffolds a new workshop repo from template/.
 *
 * The point of this command is that the next workshop is not another fork. Every
 * file it writes is either content to replace or a three-line pointer at the kit.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  mkdirSync,
  renameSync,
  statSync,
} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import process from 'node:process';

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const templateDir = join(kitRoot, 'template');

const REQUIRED_TEMPLATE_FILES = [
  'package.json',
  'docusaurus.config.ts',
  'sidebars.ts',
  'config/workshop-targets.json',
  'AGENTS.md',
  'docs/overview.md',
];

/** Files that carry __PLACEHOLDER__ tokens. Binary assets are copied untouched. */
const TEXT_EXTENSIONS = new Set(['.json', '.md', '.ts', '.tsx', '.mjs', '.js', '.css', '.example']);

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export function init({product, title, root = process.cwd()} = {}) {
  if (!product) {
    console.error('init needs --product <slug>, e.g. `workshop-kit init --product maestro`.');
    return 1;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(product)) {
    console.error(`"${product}" is not a valid slug; use lowercase letters, digits and hyphens.`);
    return 1;
  }

  const missing = REQUIRED_TEMPLATE_FILES.filter((f) => !existsSync(join(templateDir, f)));
  if (missing.length > 0) {
    console.error(`The scaffold is incomplete. Missing from template/: ${missing.join(', ')}`);
    return 1;
  }

  const dest = join(root, `workshop-${product}`);
  if (existsSync(dest)) {
    console.error(`${dest} already exists.`);
    return 1;
  }

  const kitVersion = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8')).version;
  const substitutions = {
    __PRODUCT_SLUG__: product,
    __PRODUCT_TITLE__: title || `UiPath ${titleFromSlug(product)} Workshop`,
    // Pin the kit version that scaffolded this repo, so a new workshop starts
    // from a known-good release rather than whatever is on a branch.
    __KIT_SPEC__: `github:UiPath-LAB-TEC/workshop-kit#v${kitVersion}`,
  };

  mkdirSync(dest, {recursive: true});
  cpSync(templateDir, dest, {recursive: true});

  // Stored unprefixed in the kit so it does not apply to the kit's own repo.
  const storedIgnore = join(dest, 'gitignore');
  if (existsSync(storedIgnore)) renameSync(storedIgnore, join(dest, '.gitignore'));

  let substituted = 0;
  for (const file of walk(dest)) {
    const ext = file.slice(file.lastIndexOf('.'));
    const base = file.slice(file.lastIndexOf('/') + 1);
    if (!TEXT_EXTENSIONS.has(ext) && base !== '.gitignore') continue;
    if (statSync(file).size > 512 * 1024) continue;

    const before = readFileSync(file, 'utf8');
    let after = before;
    for (const [token, value] of Object.entries(substitutions)) {
      after = after.split(token).join(value);
    }
    if (after !== before) {
      writeFileSync(file, after);
      substituted += 1;
    }
  }

  const leftovers = walk(dest).filter((file) => {
    const ext = file.slice(file.lastIndexOf('.'));
    if (!TEXT_EXTENSIONS.has(ext)) return false;
    return /__[A-Z_]+__/.test(readFileSync(file, 'utf8'));
  });
  if (leftovers.length > 0) {
    console.error(
      `Unreplaced placeholders remain in:\n${leftovers.map((f) => `  ${relative(dest, f)}`).join('\n')}`,
    );
    return 1;
  }

  console.log(`Scaffolded ${dest}`);
  console.log(`  title:       ${substitutions.__PRODUCT_TITLE__}`);
  console.log(`  kit:         ${substitutions.__KIT_SPEC__}`);
  console.log(`  substituted: ${substituted} file(s)`);
  console.log('');
  console.log('Next:');
  console.log(`  cd workshop-${product} && npm install`);
  console.log('  npx workshop-kit agents init      # add the shared AGENTS.md fence');
  console.log('  # then replace the REPLACE_ME tenant values in config/workshop-targets.json');
  return 0;
}
