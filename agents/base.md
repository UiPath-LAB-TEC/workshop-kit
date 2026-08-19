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
- Session-specific workshop values must come from `.env` via `docusaurus.config.ts` `customFields.workshop`; do not hard-code them in docs.
- Required variables are `WORKSHOP_UIPATH_ORG_NAME`, `WORKSHOP_UIPATH_TENANT_NAME`, `WORKSHOP_UIPATH_TENANT_URL`, and `WORKSHOP_ORCHESTRATOR_PARENT_FOLDER`.
- Use `WorkshopValue`, `WorkshopLink`, or `WorkshopCodeBlock` from `src/components/WorkshopEnv.tsx` when showing these values in MDX.
- In copyable prompts, use `WorkshopCodeBlock` and tokens such as `{{WORKSHOP_UIPATH_ORG_NAME}}` so rendered prompts include the current session values.
- Keep participant-specific names such as participant folder names and exercise bucket names as explicit placeholders unless a dedicated workshop variable exists for them.
- When adding, renaming, or removing workshop variables or `WorkshopEnv` imports, run `npm run check:workshop-vars`; stale tokens, unknown fields, unused imports, and defined-but-unused workshop variables should fail the check.

### Exercise Design
- Each exercise should have clear objectives, steps, success criteria, and verification checks.
- Follow the project-specific convention for objective sections and learning objectives.
- Include realistic prompts or participant inputs when the exercise calls for them; do not turn exercise pages into theory-heavy lessons unless asked.
- Prefer deterministic, lightweight assets that are easy to recreate and reset.
- When adding or changing screenshots, images, downloads, or other docs assets, run `npm run check:doc-assets` and fix every reported raw asset link or missing asset before deployment.
- Make failure handling useful: include what a common error means, what it proves, and what it does not prove.

### Downloads And Assets
- Participant source folders live under `downloads/<exercise>/`.
- Each `downloads/<name>/` directory produces exactly one `static/downloads/<name>.zip`; name the directory for the ZIP participants receive.
- Loose files placed directly at the `downloads/` root are not packaged into any ZIP and are skipped without failing the build.
- Generated ZIP files are created under `static/downloads/` by `npm run zip:downloads`.
- Downloaded project instructions such as `downloads/workshop-project/AGENTS.md` may use `{{WORKSHOP_*}}` tokens; the ZIP workflow must render them from the selected target before packaging.
- Keep original filenames organized under `downloads/<exercise>` and rely on the build-time ZIP workflow where available.
- Exercise pages should link their own relevant ZIP downloads close to the step or section that uses them.
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
