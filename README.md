# `@uipath-lab-tec/workshop-kit`

Shared Docusaurus infrastructure for the UiPath LAB TEC workshop repos.

Three workshop sites — `coding-agents-workshop`, `AMERG_IXP_Workshop_Guide`
(`workshop-ixp/` locally), and `maestro-workshop` — were independent forks of the
same scaffold. Roughly 900 lines of build tooling was duplicated three ways and
had drifted: two useful fixes existed that should have composed, and each was
missing from two of the three repos. This package is that infrastructure,
extracted once and versioned.

Content repos keep only what is genuinely theirs: `docs/`, `static/img/`,
`downloads/`, `sidebars.ts`, `config/workshop-targets.json`, and an
`AGENTS.product.md`.

## Layout

```
bin/workshop-kit.mjs     single CLI entry point
src/config/              target resolution + the Docusaurus config factory
src/commands/            one module per CLI subcommand
src/components/          WorkshopEnv React components
src/css/                 shared stylesheet
agents/base.md           THE shared "General Workshop Instructions"
schemas/                 JSON Schema for config/workshop-targets.json and the PPTX slide map
tools/                   tenant pulse dashboard, PPTX asset extractor
template/                scaffold for `workshop-kit init` (a complete, building site)
```

## CLI

```
workshop-kit prepare                  zip:downloads + doc-asset + workshop-var checks + agents build
workshop-kit agents build             regenerate AGENTS.md from base + product
workshop-kit agents check             fail if AGENTS.md is stale or hand-edited inside the fence
workshop-kit check:tenant-access      advisory tenant permission report (never fails a build)
workshop-kit build --target <name>
workshop-kit codedapp <check|pack|publish|deploy|all>
workshop-kit preview --target <name>
workshop-kit pulse
workshop-kit extract-pptx --pptx <f> --output-root <d> --manifest <f>
workshop-kit validate-config          check every target in config/workshop-targets.json
workshop-kit doctor [target]
workshop-kit repin <tag>              move a content repo onto a released kit tag
workshop-kit init --product <slug>
```

## Releasing, and repinning consumers

Tag the release and move the major tag:

```bash
git tag -a v1.3.0 -m 'v1.3.0' && git push origin v1.3.0
git tag -fa v1 -m 'Moving major tag' && git push --force origin v1
```

Then, in each content repo, `workshop-kit repin v1.3.0`.

Two traps that command exists to close:

- **`npm install` alone does not repin.** `package-lock.json` records the
  resolved *commit* of the previous tag, so npm honours the lock and keeps the
  old kit even though `package.json` names a new tag. The install prints
  "changed 1 package" and succeeds. Only the explicit
  `npm install <pkg>@<spec>` form re-resolves; `repin` uses it and then asserts
  the installed version matches the tag.
- **A release that touches `agents/base.md` moves the AGENTS.md fence hash**, so
  a repin that does not regenerate leaves `agents check` failing. `repin` does
  both in one operation and expects them in one commit.

Dependabot does **not** propose these bumps — it has no registry to poll and no
semver range to compare for a `github:` tag dependency. Repinning is deliberate
and manual by design; you are the kit author, so you already know when a release
happened. Consumers are never forced to move: a delivered workshop can stay on
an old tag indefinitely.

## CI

`.github/workflows/validate.yml` is a reusable `workflow_call` workflow. A content
repo's entire CI is:

```yaml
jobs:
  validate:
    uses: UiPath-LAB-TEC/workshop-kit/.github/workflows/validate.yml@v1
    secrets: inherit
```

It runs `agents check`, `validate-config`, `check:doc-assets`,
`check:workshop-vars`, `typecheck`, a build, and `doctor`. Because the kit repo is
private, it needs a `KIT_READ_TOKEN` secret that can read it, so npm can resolve
the dependency.

`.github/workflows/kit-ci.yml` checks the kit itself, including end-to-end
exercises of the two components that fail expensively: the `AGENTS.md` fence
composer and the ZIP pipeline's token rendering. Both assert on real behaviour and
were verified to fail when that behaviour is broken.

Every command resolves the *consumer* repo from `process.cwd()`, never from its
own location on disk — it runs from inside `node_modules`.

## Starting a new workshop

```bash
npx workshop-kit init --product <slug> [--title "UiPath X Workshop"]
cd workshop-<slug> && npm install
npx workshop-kit agents init
```

That produces a repo that builds immediately with placeholder content: three
pages, the shared stylesheet, and the full check pipeline passing. The kit pin is
stamped with the version that scaffolded it, so a new workshop starts from a
known-good release.

The whole of a new repo's infrastructure is three pointer files —
`docusaurus.config.ts` (6 lines), `src/pages/index.tsx` (1 line), and
`src/components/WorkshopEnv.tsx` (3 lines) — plus `config/workshop-targets.json`.
Everything else is content.

Replace the `REPLACE_ME` tenant values before delivering; `validate-config`
deliberately passes with them in place, since it cannot know what is real.

## Extracting a workshop from a facilitator deck

`workshop-kit extract-pptx` pulls screenshots, ordered text blocks and callout
geometry out of a `.pptx` and writes a manifest beside them. Two workshops were
built this way from a lab-guide deck.

```bash
npx workshop-kit extract-pptx \
  --pptx ~/decks/5_\ CM\ Lab\ Guide.pptx \
  --output-root static/img \
  --manifest extraction/manifest.json \
  --slide-map extraction/slide-map.json
```

Run it once without `--slide-map` first. Everything lands in
`static/img/unassigned/`, which is what you want before you know where the
exercise boundaries are. Then write the map and run it again:

```json
{
  "deck": "5_ CM Lab Guide.pptx",
  "pages": [
    {"page": "pre-reqs", "slides": [2]},
    {"page": "exercise-1", "slides": ["3-18"]},
    {"page": "exercise-2", "slides": ["20-24"]}
  ],
  "roles": [
    {"role": "answer-reveal", "match": ["answers"]},
    {"role": "sign-in", "slides": [2]}
  ]
}
```

`schemas/pptx-slide-map.schema.json` has the full shape. The map is the *only*
deck-specific input; it lives in the content repo, or nowhere at all once the
docs are the source of truth, and the deck itself is never committed.

Two things this tool exists to get right, both learned the hard way:

- **Placeholder pictures count.** An image dropped into a PowerPoint content
  placeholder is a `PlaceholderPicture` with `shape_type == PLACEHOLDER`, not
  `PICTURE`. An earlier per-repo copy filtered on `shape_type` alone and silently
  dropped 18 of 33 screenshots from one deck, with no error and no non-zero exit.
- **Numbered callout ovals are separate shapes.** They vanish the moment a
  screenshot is extracted on its own, so each is recorded as a percentage offset
  inside the picture it overlaps, ready for `.workshop-click-marker` in MDX.

`python-pptx` and `Pillow` are required, and are deliberately not project
dependencies — this is a one-off authoring step, not part of any build. The
command checks for them and prints the `pip install` line if they are absent.

## Why the components are compiled

`npm run build` emits `src/components/*.tsx` to `dist/` as plain JS plus
declarations, and `prepare` runs it automatically — including when a consumer
installs the kit from a git tag.

This is not optional. Docusaurus excludes `node_modules` from transpilation, so a
package that ships raw `.tsx` fails to parse in a consumer's build. It appears to
work under a `file:` dependency only because that is a symlink whose real path
lies outside `node_modules`, and therefore does get transpiled. Test packaging
changes against a real install (`npm pack`, then install the tarball), never
against a `file:` link.

## Versioning

- `agents/base.md` wording, or a new optional config field → **minor**
- check or pipeline bug fix → **patch**
- renamed component, removed config field, changed CLI flag → **major**

Content repos pin a caret range and rely on Dependabot to surface kit releases,
so a shared change is immediately CI-tested against every workshop.
