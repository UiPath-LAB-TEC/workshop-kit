# AGENTS.md instructions

## General Workshop Instructions

This section is shared workshop guidance. Keep it exactly the same across workshop repos unless intentionally updating the shared standard in every repo.

### Workshop Content
- Author this as a Docusaurus workshop and deploy the workshop site as a UiPath Coded Web App unless the user explicitly changes the target surface.
- For Coded Web App packaging, publishing, or deployment, rely on `$uipath-coded-apps` rather than duplicating detailed coded-app instructions here.
- Keep content customer-facing, practical, and specific to the workshop audience and UiPath surface.
- Write workshop instructions in a casual second-person voice. Prefer "you" and "your" over formal third-person wording.
- Preserve existing page structure unless a section is clearly ambiguous, incomplete, or low value.
- Prefer concrete participant actions, expected outputs, and success checks over abstract best-practice prose.
- Keep edits narrow: only add content that significantly improves the exercise or workshop flow.
- When an exercise has multiple possible paths, make the target org, tenant, folder, bucket, app, or automation surface explicit.

### Shared Naming Conventions

These names are identical in every workshop repo. A participant who has done one
workshop should recognise the structure of the next one. Do not diverge locally;
change the convention here and roll it out everywhere.

- **The prerequisites page is titled `Prerequisites`.** Where a workshop splits its
  prerequisites across several pages, title each one `Prerequisites - <Step>`, for
  example `Prerequisites - Sign-in`. Never `Pre-req`, `Pre-reqs`, or a bare step
  name. Body text that cross-references the page uses the same title verbatim.
- **Every exercise page closes with `## Success check`.** One sentence-case
  heading holding one checklist of what must be true before moving on. Do not add
  a second near-duplicate section such as `Verification Checks` — fold those items
  into the same list. A `## Recap` after it is optional, for a short narrative
  wrap-up where one genuinely adds something. An up-front `## Requirements` or
  `## Objectives` section is a different thing and may stay.
- **Coded App names are derived, and must fit 32 characters.** A target that omits
  `codedApp.name` gets `<productSlug>-<uipathTenantName>`, normalised to lowercase
  hyphens. The name is derived at config load rather than stored, so it cannot drift
  between the build and the deploy: Docusaurus compiles `baseUrl` into every asset
  path, the app is served at `/<name>/`, and a build and deploy that disagree give
  you a site where every asset 404s. Set `codedApp.name` explicitly to override --
  that is the escape hatch for a tenant whose name is too long to fit. Nothing is
  truncated automatically, because truncating collides: two tenants differing only
  by a date suffix truncate to the same name and would overwrite each other's app.
  Two targets may never resolve to the same name, which matters because `local` and
  a hosted target usually share a tenant -- give at least one of them an explicit
  name.
- **Keep the product slug to 15 characters.**
  `uip codedapp deploy` rejects a name over 32 characters, and `baseUrl` must
  always equal `/<codedApp.name>/`, so the two move together. The standard
  patterns spend most of the budget on fixed text: `workshop-<slug>-local` costs
  15, `growth-<slug>-workshop` 16, and `staging-<slug>-workshop` 17. A 15-character
  slug therefore fits every pattern; `case-management` is already at exactly 32 for
  its staging form. Abbreviate in the slug rather than the prefix -- `comms-mining`,
  not `communications-mining` -- because the prefix is what participants recognise
  across workshops. `publish` happily accepts an over-long name and only `deploy`
  refuses it, which leaves an orphan package behind, so `doctor` fails on this
  first.
- **Participant placeholders use angle brackets:** `<your-name>`, and
  `<your-initials>` where initials specifically are wanted. Never `[participant
  name]`, `[your-name]`, or `{{your-name}}`. Angle brackets read as replace-me and
  cannot be mistaken for a build-time token.
- **`{{ }}` is reserved for `{{WORKSHOP_*}}` substitution tokens.** Never use that
  shape for anything a participant is supposed to replace by hand: it looks exactly
  like a token that will be rendered at build time, and silently is not one.
- **`sidebar_position` runs contiguously from 1**, in the same order as
  `sidebars.ts`. Gaps are drift, even though the explicit sidebar hides them.
- **Front matter `title` and the page `# H1` must match exactly.**

### Screenshots And Visual Evidence
- Blur, crop, or replace sensitive data in screenshots before adding them to workshop materials. Verify what is sensitive data.
- Do not expose customer names, emails, tenant IDs, org IDs, folder IDs, tokens, URLs with secrets, queue item data, or internal-only environment details unless the user explicitly approves.
- Store screenshots under `static/img/<page-or-exercise>/`.
- Use boxes, arrows, numbered markers, or other clear callouts to show where participants should click or inspect.
- For visual callouts, create an annotated copy instead of overwriting the original extracted asset when practical.
- When a screenshot is the main evidence for a step, place it close to the instruction it supports.
- If a single exercise step includes more than one screenshot, group those screenshots in Docusaurus `Tabs`/`TabItem` instead of stacking multiple figures inline.
- Use boxes or callout sections in MDX to highlight important screenshots, expected screen states, and verification evidence.
- Avoid relying on screenshots alone for correctness; pair them with the exact text, URL, resource name, or CLI output participants should verify.

### MDX And Docusaurus Patterns
- Use native Docusaurus/MDX affordances before custom UI.
- Use admonitions such as `:::tip`, `:::info`, `:::warning`, and `:::danger` for notes, guidance, prerequisites, and failure modes.
- Use `WorkshopCodeBlock` for participant-facing prompts and sample inputs, especially when the content includes `{{WORKSHOP_*}}` tokens; it preserves Docusaurus copy affordances and renders target-specific workshop values.
- Use fenced `text` blocks only for literal commands or examples that should not perform workshop-variable substitution.
- For prompt options, prefer `Tabs` and `TabItem` with `WorkshopCodeBlock` inside each tab so the built-in copy button works and session values render correctly.
- Use links and download buttons for exercise assets that already live under `static/` or are generated from `downloads/`. 
- Do not use raw root-relative asset references such as `<img src="/img/...">`, `<a href="/downloads/...">`, `![alt](/img/...)`, or `[file](/downloads/...)` in docs. They work at localhost root but break when the Docusaurus site is hosted under a target `baseUrl`.
- Use `WorkshopImage` for images and `WorkshopDownloadLink` for downloadable files from `src/components/WorkshopEnv.tsx`; these components apply the active Docusaurus `baseUrl` for both local and hosted targets.
- Keep MDX examples short enough to scan, but complete enough to copy and run.
- Verify MDX changes with `npm run build` when practical; the repo scripts should run the docs preparation and checks automatically. Before deploying a target, run `npm run build:target -- <target>`.

### Workshop Configuration Variables

There are three separate configuration surfaces. They are not interchangeable,
and each has exactly one owner. If you are unsure where a value belongs, ask
which of these three reads it.

**1. `config/workshop-targets.json` — everything participants see. Committed.**
- The single source for org name, tenant name, tenant URL and parent folder. Per target, under `targets.<name>.workshop`.
- `createWorkshopConfig()` reads it at build time and publishes it as Docusaurus `customFields.workshop`; the `WorkshopEnv` components read it from there. Docs never see a file or an env var.
- Every `workshop-kit` command reads the same file, so the CLI and the rendered site can never disagree.
- Safe for participants to read. Never put a folder key, credential, token or any deployment-only value here.
- Base fields are `uipathOrgName`, `uipathTenantName`, `uipathTenantUrl`, `orchestratorParentFolder`, rendered by the tokens `WORKSHOP_UIPATH_ORG_NAME`, `WORKSHOP_UIPATH_TENANT_NAME`, `WORKSHOP_UIPATH_TENANT_URL`, `WORKSHOP_ORCHESTRATOR_PARENT_FOLDER`. Declare anything extra under `extraFields`, which derives the token, the type and the payload from one place.

**2. `.env.deploy.<target>` — deployment only. Git-ignored, never committed.**
- Read by the `codedapp` commands and nothing else. It has no effect on the built site.
- Supplies exactly three values: `UIPATH_FOLDER_KEY` (required to deploy), `UIPATH_CODEDAPP_VERSION` and `UIPATH_CODEDAPP_AUTHOR` (both optional).
- An already-set process env var wins over the file.
- Copy `.env.deploy.example` to `.env.deploy.<target>` to create one.

**3. `.env` and `.env.<target>` — the tenant pulse dashboard only.**
- Read by `workshop-kit pulse` and nothing else. Not by the build, not by the docs, not by deployment.
- Supplies `WORKSHOP_TARGET`, `WORKSHOP_START`, `WORKSHOP_END`, `RE_CONTEXT`.
- A plain `.env` does **not** feed workshop values into the site. If you find `WORKSHOP_UIPATH_*` keys in a `.env`, they are dead leftovers from before the kit; the values in `config/workshop-targets.json` are what actually render. Do not add them, and do not trust them when they are there.

**Choosing the target.** All three layers are keyed by target name. Precedence is
an explicit CLI argument (`workshop-kit build <target>`), then the
`WORKSHOP_TARGET` env var, then `defaultTarget` in
`config/workshop-targets.json`. `build:target` and `start:target` set
`WORKSHOP_TARGET` for the Docusaurus process.

Other rules for these values:
- Use `WorkshopValue`, `WorkshopLink`, or `WorkshopCodeBlock` from `src/components/WorkshopEnv.tsx` when showing these values in MDX.
- In copyable prompts, use `WorkshopCodeBlock` and tokens such as `{{WORKSHOP_UIPATH_ORG_NAME}}` so rendered prompts include the current session values.
- Keep participant-specific names such as participant folder names and exercise bucket names as explicit `<your-name>` placeholders unless a dedicated workshop variable exists for them.
- **No delivery-specific literal belongs in `docs/`.** A tenant URL, an org, a join
  link, a Studio Web template name, a cohort, a city or a date that changes between
  deliveries goes in `config/workshop-targets.json` and renders through
  `WorkshopValue` / `WorkshopLink`. Declare anything beyond the four base fields
  under `extraFields`. If you find yourself typing a city or a month into a docs
  page, add the variable instead.
- When adding, renaming, or removing workshop variables or `WorkshopEnv` imports, run `npm run check:workshop-vars`; stale tokens, unknown fields, unused imports, and defined-but-unused workshop variables should fail the check.

### Exercise Design
- Each exercise should have clear objectives, steps, and one closing `## Success check` list. See Shared Naming Conventions above.
- Follow the project-specific convention for objective sections and learning objectives.
- Include realistic prompts or participant inputs when the exercise calls for them; do not turn exercise pages into theory-heavy lessons unless asked.
- Prefer deterministic, lightweight assets that are easy to recreate and reset.
- When adding or changing screenshots, images, downloads, or other docs assets, run `npm run check:doc-assets` and fix every reported raw asset link or missing asset before deployment.
- Make failure handling useful: include what a common error means, what it proves, and what it does not prove.

### Downloads And Assets
- Participant source folders live under `downloads/<exercise>/`.
- Each `downloads/<name>/` directory produces exactly one `static/downloads/<name>.zip`; name the directory for the ZIP participants receive.
- Name a download for what is inside it, not just for the exercise number: `exercise-3-paystubs`, `exercise-2-taxonomy`, `workshop-project`. A participant with three ZIPs in their Downloads folder should be able to tell them apart.
- Loose files placed directly at the `downloads/` root are not packaged into any ZIP and are skipped without failing the build.
- Generated ZIP files are created under `static/downloads/` by `npm run zip:downloads`.
- Downloaded project instructions such as `downloads/workshop-project/AGENTS.md` may use `{{WORKSHOP_*}}` tokens; the ZIP workflow must render them from the selected target before packaging.
- Keep original filenames organized under `downloads/<exercise>` and rely on the build-time ZIP workflow where available.
- Exercise pages should link their own relevant ZIP downloads close to the step or section that uses them.
- Serve participant files from the site itself through `WorkshopDownloadLink`. Do not link an external file host such as Google Drive, Dropbox, or a SharePoint file: those links leak outside the repo, cannot be versioned with the content, and go stale between deliveries.
- Track missing participant files in a project-specific checklist when downloads are still incomplete.

### Validation
- Before reporting a docs change complete, run the main validation command:

```bash
npm run build
```

- Before deploying a hosted target, run:

```bash
npm run build:target -- <target>
```

- If a build prints environment or update-check warnings, treat them as non-fatal only when the build itself succeeds.

### Tenant Checks And Build-Time Validation

**Gate `requiresTenantAccess` on the tenant a target points at, not on its name.**
A target called `growth` may address a real `uipathlabstraining` delivery tenant in
one repo and the shared `growthuipath/Workshops` testing tenant in another. The
group convention `<tenant>-Participants` / `<tenant>-Facilitators` holds only on
the delivery tenants, so switching the check on for a testing target produces
"group not found" on every build for names that were never expected to exist.

`check:tenant-access` is the advisory pre-delivery check: it reports whether the
participant and facilitator groups hold the roles the exercises need, and whether
the tenant has the AI Units and IXP quota headroom to survive the workshop. It
runs inside `build:target` for any target that sets `requiresTenantAccess`, which
means it also runs inside `codedapp pack` and `codedapp all`.

The rules below were paid for by `ca-tenant-access-wiring.patch`: a hand-written
patch that wired this same check up and was never applied. Every one of them is a
mistake that patch made, and the check it wired had never executed once.

- **A step that touches a live tenant is gated on the resolved target, never on
  an npm lifecycle hook.** That patch put the check in `prebuild`, which fires on
  any `npm run build` — including an offline build with no target argument. There
  is no resolved target on that path, so the check falls back to `defaultTarget`
  and validates whichever tenant that names, which is not the one being built.
  Use `requiresTenantAccess` on the target instead, and leave it off for `local`.
- **One step, one home.** That patch added the check in two places at once
  (`prebuild` and the target runner). Two call sites for one decision drift, and
  the one you are not looking at is the one that runs.
- **An advisory check must not be able to fail a build.** Setting exit code 0
  inside the script is not enough: that contract only holds while the script runs
  at all. A crash before its own handler — an unresolvable import, no `uip` or
  `re` on PATH, an unreachable tenant — exits non-zero, and a throwing caller
  turns that into a failed deploy. Invoke advisory steps through a runner that
  reports and continues. Shipping a workshop site must never depend on a
  reachable tenant.
- **Never leave a decision as a `.patch` file in the tree.** That one sat
  unapplied long enough for the layout it targeted (flat `scripts/*.mjs`) to stop
  existing in every repo, so it could not be applied even if someone wanted to.
  Record the decision in `TODO.md` and make the change, or drop it.
- **A check that never runs is worse than no check**, because it reads as
  coverage. That one was referenced by the schema, reported on by `doctor`, and
  documented — while dying on an unresolved import on every invocation. When
  wiring up a validation step, run it and read its output before believing it.
- **Syntax checks do not resolve imports.** `node --check` passes on a module
  whose every import is broken, which is exactly how that import shipped. If CI
  gates a script it never executes, gate its import edges too.

### Quota And Licence Surfaces

- **IXP quotas come from the `re` CLI, not `uip`.** They are a Reinfer concept.
  `uip ixp` has no capacity command at all, and its project list returns only a
  count. `re get quotas` returns each kind with a real `hard_limit` and
  `current_max_usage` — `sources`, `datasets`, `buckets`, `comments`,
  `comments_per_source`, `integrations`, `triggers_per_dataset`,
  `extraction_predictions` — so no ceiling ever needs to be hand-declared.
  Declare only the per-participant need.
- **Discover limits, do not declare them.** A hand-written cap is a guess at a
  number the tenant already knows, and it goes stale silently.
- **Match a `re` context, do not pass `--endpoint`.** The API token lives in the
  context. Find the context whose endpoint addresses the same org and tenant as
  the workshop target; the two URLs differ only in a trailing `reinfer_` against
  `orchestrator_`. Read contexts from what `re config ls` prints, never from the
  file `re` stores them in — that file holds tokens.
- **Cross-check licence figures before trusting headroom.** `uip platform
  licenses summary` and `uip platform licenses consumables get` disagree: on one
  org the summary reported 3,675,583 AI Units consumed against the same 5,000,000
  pool that the per-tenant rows summed to 1,796,083. Take the larger consumption
  figure and surface the gap. `Available` is null for consumables and `Allocated`
  is what the org handed to tenants, so headroom must be derived from
  `TotalUnitsInAccount` rather than read from a field.
- **Missing local tooling is a skip, not a warning.** `re` installs separately
  from `uip`, so most machines will not have it. Report that as a skipped check
  with a note on how to enable it, counted apart from warnings. A check that
  warns on every build is a check nobody reads, and it buries the real findings.
- **Let a tool hold its own credentials.** IXP quotas need a `re` context, set up
  once per tenant with `re config add`. Do not route an API key through
  `.env.deploy.<target>` and a temporary config file to avoid that manual step:
  it works, but it makes the check handle a raw key, write it to disk, and depend
  on another tool's config format. Read contexts from `re config ls` output, never
  from the file `re` stores them in -- that file holds tokens. Accept the setup
  burden and skip cleanly when it is not done.
- **Say how short, and what to raise it to.** A capacity warning that only reports
  a shortfall leaves the reader to work out the number to put in a quota request.
  Recommend current usage plus the full workshop need plus a margin — not the gap,
  because existing usage does not go away, and a ceiling raised by only the gap
  leaves zero headroom the moment the workshop ends.
- **A threshold that silently defaults to off is a false pass.** Validate the
  keys of any capacity or quota configuration. `aiUnitsPerParticipants` — plural,
  one character off — otherwise falls back to 0 and turns the check off while
  still reporting green. Where the key set cannot be closed (quota kinds are
  discovered from the tenant), warn at run time about a declared key the tenant
  does not report, and list the ones it does.

### Visual Design
- Reports, dashboards, visual tools, and HTML pages should include a dark-mode option.
- Workshop pages should be readable and utilitarian, not marketing-style landing pages.
- Avoid decorative UI that distracts from instructions, screenshots, prompts, and verification outputs.

### Local Files
- When the result is a local file, share the filepath, a button/link to open the file in the default external app, and a button/link to open the containing folder in Finder.

### UiPath
- When deploying something to UiPath, provide a direct URL to the deployed asset.
- Confirm the intended target before implementing when a project has both local and hosted surfaces, multiple tools, or multiple configurations.
- Use the configured workshop target from `config/workshop-targets.json`.
- Keep deployment-only values in `.env.deploy.<target>`.
- Do not commit deployment-only values, folder keys, credentials, tokens, or secrets into tracked source files.
- Do not hard-code folder keys, credentials, tokens, or tenant-specific secrets in tracked docs or instructions.
- Package, publish, and deploy through the project scripts unless the project-specific instructions say otherwise.
- After deployment, verify at least one hosted page, asset, or download returns successfully.
- After deployment, report the live URL returned by the deploy command.

### Collaboration Notes
- The user may make quick manual edits to Markdown and ask for redeploy. Treat their edits as source of truth; validate and redeploy the current workspace state.
- Keep final summaries concise: what changed, what passed, deployed version if applicable, and any files still needed from the user.
