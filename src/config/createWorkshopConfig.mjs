/**
 * Docusaurus config factory. Owns everything the three workshop sites had
 * identical: the classic preset, themeConfig, navbar and footer shape,
 * onBrokenLinks, i18n, future flags, and the customFields.workshop wiring.
 *
 * A content repo's docusaurus.config.ts becomes:
 *
 *   import {createWorkshopConfig} from '@uipath-lab-tec/workshop-kit/config';
 *   export default createWorkshopConfig();
 *
 * title, tagline and repo are read from config/workshop-targets.json so they have
 * one home, shared with the CLI commands, and can be schema-validated. Pass
 * overrides for anything a specific workshop genuinely needs to differ.
 *
 * Shipped as .mjs rather than .ts: the Docusaurus config loader is a Node-level
 * loader, not webpack, so a .ts file imported from node_modules is not reliably
 * transpiled. Types live in createWorkshopConfig.d.ts.
 */
import {createRequire} from 'node:module';
import {join} from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Resolve from the CONSUMER, not the kit. Under a `file:` dependency the kit is a
 * symlink, so Node resolves the kit's imports against the kit's real path and
 * never sees the consumer's node_modules. Every workshop already depends on
 * prism-react-renderer and Docusaurus directly, so ask them; fall back to the
 * kit's own resolution for a normal hoisted install.
 */
function fromConsumer(specifier) {
  try {
    return createRequire(join(process.cwd(), 'package.json'))(specifier);
  } catch {
    return require(specifier);
  }
}

function resolveFromConsumer(specifier) {
  try {
    return createRequire(join(process.cwd(), 'package.json')).resolve(specifier);
  } catch {
    return require.resolve(specifier);
  }
}

const {themes: prismThemes} = fromConsumer('prism-react-renderer');
import {getTarget} from './workshop-target.mjs';
import {readTargetsConfig, resolveFields, tokenToFieldMap, workshopPayload} from './workshop-fields.mjs';

export function createWorkshopConfig(overrides = {}) {
  const root = process.cwd();
  const config = readTargetsConfig(root);
  const {targetName, target} = getTarget();
  const fields = resolveFields(config);

  const title = overrides.title ?? config.title;
  const tagline = overrides.tagline ?? config.tagline;
  const repo = overrides.repo ?? config.repo;
  // Each repo worded this differently ("Workshop Docs", "IXP Workshop Docs",
  // "Maestro Workshop Docs"). User-visible, so it stays per-repo rather than
  // being flattened to whichever repo the factory was written against.
  const docsLabel = overrides.docsLabel ?? config.docsLabel ?? 'Workshop Docs';

  for (const [name, value] of Object.entries({title, tagline, repo})) {
    if (!value) {
      throw new Error(
        `createWorkshopConfig: "${name}" is required. Set it in config/workshop-targets.json or pass it as an override.`,
      );
    }
  }

  const [organizationName, projectName] = repo.split('/');
  if (!organizationName || !projectName) {
    throw new Error(`createWorkshopConfig: "repo" must be "<org>/<repo>", got "${repo}".`);
  }
  const repoUrl = `https://github.com/${repo}`;

  const base = {
    title,
    tagline,
    favicon: 'img/favicon.ico',

    customFields: {
      targetName,
      workshop: workshopPayload(fields, target),
      // The token map travels to the browser so WorkshopEnv can render
      // {{WORKSHOP_*}} tokens without a hardcoded copy of it.
      workshopTokens: tokenToFieldMap(fields),
    },

    future: {
      v4: true,
    },

    url: target.siteUrl,
    baseUrl: target.baseUrl,

    organizationName,
    projectName,

    onBrokenLinks: 'throw',

    i18n: {
      defaultLocale: 'en',
      locales: ['en'],
    },

    presets: [
      [
        'classic',
        {
          docs: {
            sidebarPath: './sidebars.ts',
            editUrl: `${repoUrl}/tree/main/`,
          },
          blog: false,
          theme: {
            customCss: overrides.customCss ?? [
              resolveFromConsumer('@uipath-lab-tec/workshop-kit/css/workshop.css'),
            ],
          },
        },
      ],
    ],

    themeConfig: {
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title,
        logo: {
          alt: 'UiPath',
          src: 'img/logo.svg',
          srcDark: 'img/logo-dark.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'workshopSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            href: repoUrl,
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [{label: docsLabel, to: '/docs/overview'}],
          },
          {
            title: 'More',
            items: [{label: 'GitHub', href: repoUrl}],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} UiPath LAB TEC. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    },
  };

  return typeof overrides.extend === 'function' ? overrides.extend(base) : base;
}

export default createWorkshopConfig;
