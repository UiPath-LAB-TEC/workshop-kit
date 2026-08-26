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
workshop-kit check:tenant-access      advisory tenant permission + capacity report (never fails a build)
workshop-kit build --target <name>
workshop-kit codedapp <check|pack|publish|deploy|all>   pack prunes old nupkgs
workshop-kit preview --target <name>
workshop-kit pulse
workshop-kit extract-pptx --pptx <f> --output-root <d> --manifest <f>
workshop-kit validate-config          check every target in config/workshop-targets.json
workshop-kit doctor [target]
workshop-kit repin <tag>              move a content repo onto a released kit tag
workshop-kit init --product <slug>
```

## The tenant check

`check:tenant-access` answers one question before a workshop is delivered: can
this tenant actually run it? It reports two things.

**Permissions.** Whether the `<tenant>-Participants` and `<tenant>-Facilitators`
groups hold the Document Understanding, Data Fabric, Studio Web and folder roles
the exercises need, and whether the IXP (`reinfer`) service is enabled. For a
missing role it prints the `uip` command that grants it, and never runs it.

The group names are a convention, and it is not universal. `<tenant>-Participants`
and `<tenant>-Facilitators` is what the check looks for, but real training tenants
also use `Workshop Participants`, `Workshop Trainers`, and per-cohort names like
`Workshops CM-1` or `Workshop-OKC`. When the convention does not match, every group
check reports "not found" — which reads as a permission problem but is really a
naming mismatch, so check the tenant's actual groups with `uip admin groups list`
before believing it.

**Capacity.** AI Unit and Agent Unit headroom in the account, and every IXP quota
the tenant reports. This is the half that catches "we ran out of units halfway
through" and "nobody can create another dataset" on the morning of delivery
rather than during it.

Two notes on how the capacity numbers are read, both of which cost time to
establish:

- Headroom is derived, not read. `Available` is null for consumables in the
  licence summary and `Allocated` is what the org handed to tenants, so neither
  is the answer. The check subtracts consumption from `TotalUnitsInAccount`.
- The two licence surfaces disagree, so the check reads both and takes the
  larger consumption figure. On one org the summary reported 3,675,583 AI Units
  consumed against the same 5,000,000 pool that the per-tenant rows summed to
  1,796,083 — a 1.9M gap. Trusting the smaller number would have overstated
  headroom 2.4x, in the one check whose job is to stop a workshop running out.
  The gap is printed rather than hidden.

**IXP quotas come from `re`, not `uip`.** They are a Reinfer concept, and `uip`
cannot see them at all — `uip ixp` has no capacity command, and its project list
returns only a count. `re get quotas` returns every kind with a real
`hard_limit` and `current_max_usage`: `sources`, `datasets`, `buckets`,
`comments`, `comments_per_source`, `integrations`, `triggers_per_dataset`,
`extraction_predictions`. So no ceiling has to be declared — only the
per-participant need.

### Getting `re` credentials to the check

The check finds the `re` context whose endpoint addresses the same org and tenant
as the target, comparing the first two path segments (the endpoints differ only in
a trailing `reinfer_` against `orchestrator_`). Contexts are read from the table
`re config ls` prints, never from the file `re` stores them in — that file holds
tokens.

So the operator sets this up once, with `re`'s own supported command:

```bash
re config add --name <name> --endpoint https://cloud.uipath.com/<org>/<tenant>/reinfer_/ --token <token>
```

This is deliberately the only route. A token could instead live in
`.env.deploy.<target>` and be materialised into a temporary `--config-file` —
that works, and it was tried — but it puts this check in the business of handling
a raw API key, writing it to disk, and depending on `re`'s config file format
staying put. `re config add` is the supported way to hold Reinfer credentials, so
the setup burden stays with the operator. It is a real burden: it is a manual step
per tenant, and without it IXP quotas skip.

### Skips are not warnings

`re` ships separately from `uip` and most people building a workshop site will not
have it. That is a fact about a laptop, not a finding about a tenant, so a missing
`re` — or missing Reinfer credentials — is reported as `SKIP`, counted separately
from warnings, and followed by a short note on how to make it run next time. A
check that warns on every build is a check nobody reads.

### Turning it on

A target runs the check at build time when it sets `requiresTenantAccess`, and
gets pass/warn thresholds instead of a bare readout when it declares `capacity`:

```json
"growth": {
  "requiresTenantAccess": true,
  "capacity": {
    "participants": 25,
    "aiUnitsPerParticipant": 2000,
    "ixpQuotaPerParticipant": {"datasets": 1, "sources": 2}
  }
}
```

Every `capacity` field is optional and defaults to 0, which means "report the
number, do not judge it". So a target that declares nothing still gets the full
readout, and only a target that states what it needs can warn — an unconfigured
repo never warns on a healthy tenant, which is how an advisory check earns being
read. `validate-config` rejects unknown keys inside `capacity`, because
`aiUnitsPerParticipants` — plural, one character off — would otherwise fall back
to 0 and silently switch the AI Unit threshold off. The quota kinds inside
`ixpQuotaPerParticipant` are deliberately *not* a closed set, since a new product
quota kind would then fail every build; instead the check warns at run time when a
declared kind is one the tenant does not report, and lists the kinds it does.

Leave `requiresTenantAccess` off for `local`: an offline build must never depend
on a reachable tenant. With it on, the check runs inside `build --target`, which
means it also runs inside `codedapp pack` and `codedapp all`, since both build
the site first. It cannot fail a deploy — a crash in the check (no `uip` on PATH,
an unreachable tenant) is reported and the build continues.

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
`check:workshop-vars`, `typecheck`, a build, and `doctor`. The kit repo is public,
so `npm ci` resolves the `github:` dependency with no credentials and nothing
needs to be passed in. The optional `KIT_READ_TOKEN` secret is a leftover from
when the kit was private: `validate.yml` skips its auth step when the secret is
absent, and no repo defines it, so `secrets: inherit` above passes nothing. It
can be dropped from both once you are sure the kit stays public.

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

## Packing and deploying the Coded App

`workshop-kit codedapp <check|pack|publish|deploy|all>` builds the site for a
target and ships it as a UiPath Coded Web App. `check` prints the resolved
target, app name and whether the deploy env is present, and touches nothing.

Every `pack` writes a fresh timestamped `.uipath/<name>.<version>.nupkg`, and
`uip` never removes one. Left alone that grows without bound — one repo reached
147 MB across 21 files in two months. After a successful pack the kit keeps the
newest **3 packages per package name** and deletes the rest, reporting what it
removed. Override with `UIPATH_CODEDAPP_KEEP`; a value below 1 or non-numeric
falls back to 3 with a warning.

Per *name*, not per directory, because a repo packs a different app name per
training target — `tc20260721-ca-workshop`, `ifca20260722-ca-workshop`, and so
on. A global "keep the newest 3" would delete an older target's only package the
moment you pack a different one, and `publish` is a separate command that runs
against the local file, so that would break pack-now-publish-later. Grouping by
name also guarantees the file the current run just produced survives.

Coded App names must be unique across the whole **organisation**, not merely
within a folder or a tenant: deployed apps share one org-wide `*.uipath.host` URL
space, and `baseUrl` must equal `/<codedApp.name>/`. Deploying a name another
tenant already holds fails with `This app name is already deployed in this
folder`, which names the wrong scope — the conflict is the URL, not the folder.
A repo with no local `.uipath/` state does not fail early either: `publish`
registers a *second* app of the same name in whichever tenant you happen to be
logged into, and only the later `deploy` refuses.

Local packages are build artifacts, not the deliverable: `publish` uploads to
Orchestrator. `.uipath/` and `uipath.json` are gitignored in every content repo
and must never be committed. Files in `.uipath/` that are not named
`<name>.<semver>.nupkg` — including `app.config.json` and `metadata.json` — are
left alone.

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

- new CLI command, `agents/base.md` wording, or a new optional config field → **minor**
- check or pipeline bug fix → **patch**
- renamed component, removed config field, changed CLI flag → **major**

**The version number is a signal, not a trigger. Nothing updates on its own.**

A content repo pins one exact tag:

```json
"@uipath-lab-tec/workshop-kit": "github:UiPath-LAB-TEC/workshop-kit#v1.3.0"
```

That is a tag, not a caret range, and it resolves through `package-lock.json` to
a specific commit. Three consequences follow, and all three are deliberate:

1. **Dependabot cannot bump it.** There is no registry to poll and no semver
   range to compare for a `github:` tag dependency. The `dependabot.yml` in each
   content repo covers `@docusaurus/*` and GitHub Actions only — a kit group
   used to sit there doing nothing, which read as if the bumps were automatic.
2. **`npm install` cannot bump it either.** The lockfile records the resolved
   commit of the *previous* tag, so npm honours the lock, prints "changed 1
   package", and keeps the old kit even after you edit `package.json`. See
   "Releasing, and repinning consumers" above.
3. **Only `workshop-kit repin <tag>` moves a repo**, and someone has to run it,
   per repo, on purpose.

So a **major** does not break every workshop the day it is tagged. It breaks the
next repo that repins, whenever that is. A workshop already delivered can sit on
an old tag indefinitely and keep building — which is the point, because a repo
is often frozen mid-delivery while the kit moves on.

The cost of that safety is that a shared fix is *not* live everywhere until you
repin each repo. Cross-repo CI proves a change is safe; it does not deliver it.
Treat "tag the kit" and "repin the consumers" as two separate jobs, and expect
repos to sit on different tags in between.
