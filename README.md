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
schemas/                 JSON Schema for config/workshop-targets.json
tools/                   tenant pulse dashboard
template/                scaffold for `workshop-kit init`
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
workshop-kit validate-config          check every target in config/workshop-targets.json
workshop-kit doctor
workshop-kit init --product <slug>
```

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

## Versioning

- `agents/base.md` wording, or a new optional config field → **minor**
- check or pipeline bug fix → **patch**
- renamed component, removed config field, changed CLI flag → **major**

Content repos pin a caret range and rely on Dependabot to surface kit releases,
so a shared change is immediately CI-tested against every workshop.
