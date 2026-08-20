# __PRODUCT_TITLE__

A UiPath LAB TEC workshop site. Infrastructure comes from
[`@uipath-lab-tec/workshop-kit`](https://github.com/UiPath-LAB-TEC/workshop-kit);
this repo holds content.

```bash
npm install
npm start
```

| Command | Purpose |
|---|---|
| `npm start` | Local dev server |
| `npm run build` | Production build |
| `npm run build:target -- <target>` | Build for a specific tenant target |
| `npm run preview:target -- <target>` | Serve `build/` at the target's baseUrl |
| `npx workshop-kit doctor` | Kit version, resolved target, drift |
| `npx workshop-kit validate-config` | Check every target |

`AGENTS.md` carries the shared standard inside a fenced region managed by the
kit. Edit below the fence; `npm run prepare:docs` refreshes the fence, and CI
fails if it has drifted.
