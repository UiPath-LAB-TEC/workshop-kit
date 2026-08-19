import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The consumer repo, not the kit: this file runs from inside node_modules.
// __dirname stays the kit dir, for dashboard.html.
const ROOT_DIR = process.cwd();

const PORT = Number(process.env.TENANT_PULSE_PORT || 8788);
const REFRESH_INTERVAL_MS = 120_000;
const MAX_WINDOW_MS = 8 * 60 * 60 * 1000;

const pulseCache = new Map();
let targetsPromise = null;
let envPromise = null;

function runUip(args) {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile("uip", args, { timeout: 90_000, maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
      const finished = Date.now();
      resolve({
        args,
        command: `uip ${args.join(" ")}`,
        durationMs: finished - started,
        exitCode: error?.code ?? 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
        parsed: parseJsonEnvelope(`${stdout}\n${stderr}`),
        error: error ? String(error.message || error) : null,
      });
    });
  });
}

function runRe(args) {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile("re", args, { timeout: 90_000, maxBuffer: 12 * 1024 * 1024 }, (error, stdout, stderr) => {
      const finished = Date.now();
      resolve({
        args,
        command: `re ${args.join(" ")}`,
        durationMs: finished - started,
        exitCode: error?.code ?? 0,
        signal: error?.signal ?? null,
        stdout,
        stderr,
        parsedLines: parseJsonLines(stdout),
        error: error ? String(error.message || error) : null,
      });
    });
  });
}

function parseJsonEnvelope(output) {
  const objectStart = output.indexOf("{");
  const arrayStart = output.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) return null;

  const start = Math.min(...starts);
  const end = Math.max(output.lastIndexOf("}"), output.lastIndexOf("]"));
  if (end < start) return null;

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseJsonLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function okEnvelope(result) {
  return Boolean(result.exitCode === 0 && result.parsed && result.parsed.Result === "Success");
}

function summarizeCommand(result, count = null) {
  return {
    command: result.command,
    ok: okEnvelope(result),
    count,
    durationMs: result.durationMs,
    code: result.parsed?.Code ?? null,
    exitCode: result.exitCode,
    message: result.error || result.parsed?.Message || "",
  };
}

function summarizeReCommand(result, count = null) {
  return {
    command: result.command,
    ok: result.exitCode === 0,
    count,
    durationMs: result.durationMs,
    code: result.exitCode === 0 ? "ReinferProjectList" : "ReinferError",
    exitCode: result.exitCode,
    message: result.error || result.stderr || "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listAll(baseArgs) {
  const all = [];
  const commands = [];
  const limit = 100;
  let offset = 0;

  for (let page = 0; page < 50; page += 1) {
    let result = await runUip([...baseArgs, "--limit", String(limit), "--offset", String(offset), "--output", "json"]);
    if (!okEnvelope(result)) {
      commands.push(summarizeCommand(result, 0));
      await sleep(1_000);
      result = await runUip([...baseArgs, "--limit", String(limit), "--offset", String(offset), "--output", "json"]);
    }
    const rows = Array.isArray(result.parsed?.Data) ? result.parsed.Data : [];
    all.push(...rows);
    commands.push(summarizeCommand(result, rows.length));

    if (!okEnvelope(result)) {
      throw new Error(`${result.command} failed${result.error ? `: ${result.error}` : ""}`);
    }

    const returned = Number(result.parsed?.Pagination?.Returned ?? rows.length);
    const hasMore = Boolean(result.parsed?.Pagination?.HasMore);
    if (!hasMore || returned <= 0) break;
    offset += returned;
  }

  return { rows: all, commands };
}

async function readJsonIfExists(filePath) {
  try {
    await access(filePath);
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadDashboardEnv() {
  if (!envPromise) {
    envPromise = (async () => {
      const baseEnv = parseEnvText(await readTextIfExists(path.join(ROOT_DIR, ".env")));
      const selectedTarget = process.env.WORKSHOP_TARGET || baseEnv.WORKSHOP_TARGET || "";
      const targetEnv = selectedTarget ? parseEnvText(await readTextIfExists(path.join(ROOT_DIR, `.env.${selectedTarget}`))) : {};
      const deployEnv = selectedTarget ? parseEnvText(await readTextIfExists(path.join(ROOT_DIR, `.env.deploy.${selectedTarget}`))) : {};
      return { ...baseEnv, ...targetEnv, ...deployEnv, ...process.env };
    })();
  }
  return envPromise;
}

function envValue(env, ...names) {
  for (const name of names) {
    if (String(env[name] || "").trim()) return String(env[name]).trim();
  }
  return "";
}

function inferReContext(organization, tenant) {
  if (!organization || !tenant) return "";
  return `UiPath_${organization}_${tenant}`;
}

function normalizeWorkshopTarget(targetName, target, env) {
  const tenantUrl = String(target.workshop?.uipathTenantUrl || "").replace(/\/$/, "");
  const parsed = new URL(tenantUrl || "https://cloud.uipath.com");
  const parts = parsed.pathname.split("/").filter(Boolean);
  const organization = target.workshop?.uipathOrgName || parts[0] || "";
  const tenant = target.workshop?.uipathTenantName || parts[1] || "";
  const baseUrl = `${parsed.protocol}//${parsed.host}`;
  const selectedTarget = envValue(env, "WORKSHOP_TARGET");
  const selectedStart = targetName === selectedTarget ? envValue(env, "WORKSHOP_START", "TENANT_PULSE_WORKSHOP_START", "WORKSHOP_START_TIME") : "";
  const selectedEnd = targetName === selectedTarget ? envValue(env, "WORKSHOP_END", "TENANT_PULSE_WORKSHOP_END", "WORKSHOP_END_TIME") : "";
  const selectedReContext = targetName === selectedTarget ? envValue(env, "RE_CONTEXT", "REINFER_CONTEXT", "UIPATH_RE_CONTEXT", "UIPATH_REINFER_CONTEXT") : "";

  return {
    id: targetName,
    label: target.label || target.codedApp?.name || targetName,
    environment: targetName,
    baseUrl,
    organization,
    tenant,
    tenantUrl,
    url: tenantUrl,
    reContext: target.reContext || target.workshop?.reContext || selectedReContext || inferReContext(organization, tenant),
    workshopStart: selectedStart || target.workshop?.start || target.workshop?.workshopStart || "",
    workshopEnd: selectedEnd || target.workshop?.end || target.workshop?.workshopEnd || "",
  };
}

async function loadTargets() {
  if (!targetsPromise) {
    targetsPromise = (async () => {
      const env = await loadDashboardEnv();
      const config = await readJsonIfExists(path.join(ROOT_DIR, "config", "workshop-targets.json"));
      const configuredTargets = config?.targets || {};
      const targets = Object.entries(configuredTargets).map(([targetName, target]) => normalizeWorkshopTarget(targetName, target, env));
      if (targets.length === 0) throw new Error("No tenant pulse targets configured.");
      return targets;
    })();
  }
  return targetsPromise;
}

async function getTarget(id) {
  const targets = await loadTargets();
  const env = await loadDashboardEnv();
  const defaultId = envValue(env, "WORKSHOP_TARGET") || id;
  return targets.find((target) => target.id === id) || targets.find((target) => target.id === defaultId) || targets[0];
}

function publicTarget(target) {
  return {
    id: target.id,
    label: target.label,
    environment: target.environment,
    baseUrl: target.baseUrl,
    organization: target.organization,
    tenant: target.tenant,
    tenantUrl: target.tenantUrl,
    reContext: target.reContext,
    workshopStart: target.workshopStart,
    workshopEnd: target.workshopEnd,
  };
}

function assertTarget(login, target) {
  const data = login.parsed?.Data || {};
  if (!okEnvelope(login) || data.Status !== "Logged in") {
    throw new Error("UiPath CLI is not logged in. Run `uip login` and reload the dashboard.");
  }

  const active = {
    baseUrl: data.BaseUrl,
    organization: data.Organization,
    tenant: data.Tenant,
  };

  if (
    active.baseUrl !== target.baseUrl ||
    active.organization !== target.organization ||
    active.tenant !== target.tenant
  ) {
    throw new Error(
      `Active UiPath context is ${active.baseUrl}/${active.organization}/${active.tenant}; expected ${target.tenantUrl}. Run \`uip login tenant set "${target.tenant}" --output json\` and reload.`,
    );
  }

  return active;
}

function uniqueValues(rows, fieldName) {
  return new Set(rows.map((row) => row[fieldName]).filter(Boolean)).size;
}

function codedWebAppUrl(orgName, routingName) {
  if (!orgName || !routingName) return "";
  return `https://${orgName}.uipath.host/${encodeURIComponent(routingName)}`;
}

function ixpProjectUrl(target, projectName) {
  if (!target?.tenantUrl || !projectName) return "";
  return `${target.tenantUrl}/reinfer_/projects/${encodeURIComponent(projectName)}`;
}

function foldersUrl(target) {
  return `${target.tenantUrl}/orchestrator_/folders`;
}

function bucketsUrl(target) {
  return `${target.tenantUrl}/orchestrator_/buckets`;
}

function parseDate(value, fallback = "") {
  const iso = value || fallback;
  const time = Date.parse(iso);
  if (!iso || Number.isNaN(time)) return null;
  return new Date(time);
}

function resolveWindow(target, requestedStart, requestedEnd) {
  const start = parseDate(requestedStart, target.workshopStart);
  const end = parseDate(requestedEnd, target.workshopEnd);
  const now = new Date();
  if (!start || !end) {
    return {
      valid: false,
      state: "unscheduled",
      start: requestedStart || target.workshopStart || "",
      end: requestedEnd || target.workshopEnd || "",
      now: now.toISOString(),
      message: "Set a workshop start and end time to enable automatic refresh and timeline plotting.",
    };
  }
  const durationMs = end.getTime() - start.getTime();
  if (durationMs <= 0 || durationMs > MAX_WINDOW_MS) {
    return {
      valid: false,
      state: "invalid",
      start: start.toISOString(),
      end: end.toISOString(),
      now: now.toISOString(),
      message: "Workshop window must be greater than 0 minutes and no longer than 8 hours.",
    };
  }
  let state = "active";
  if (now < start) state = "upcoming";
  if (now > end) state = "ended";
  return {
    valid: true,
    state,
    start: start.toISOString(),
    end: end.toISOString(),
    now: now.toISOString(),
    durationMs,
    message: state === "active" ? "Automatic refresh is active for this target." : "Automatic refresh is paused outside the workshop window.",
  };
}

function cacheKey(target, window) {
  return `${target.id}::${window.start || ""}::${window.end || ""}`;
}

function emptyPulse(target, window, message) {
  return {
    ok: true,
    paused: true,
    stale: false,
    target: publicTarget(target),
    activeContext: null,
    window,
    updatedAt: new Date().toISOString(),
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    durationMs: 0,
    message,
    counts: { folders: 0, buckets: 0, codedWebApps: 0, ixpProjects: 0, standardFolders: 0, uniqueBucketNames: 0 },
    resourceLinks: { folders: foldersUrl(target), buckets: bucketsUrl(target) },
    timeline: buildTimeline([], [], [], [], window),
    folders: [],
    buckets: [],
    codedWebApps: [],
    ixpProjects: [],
    commands: [],
  };
}

async function listIxpProjects(target) {
  try {
    if (!target.reContext) {
      return {
        rows: [],
        commands: [
          {
            command: "re -c <missing> -o json get projects",
            ok: false,
            count: 0,
            durationMs: 0,
            code: "ReinferMissingContext",
            exitCode: 1,
            message: "Target has no reContext configured.",
          },
        ],
        error: "Target has no reContext configured.",
      };
    }

    let result = await runRe(["-c", target.reContext, "-o", "json", "get", "projects"]);
    const commands = [];
    if (result.exitCode !== 0) {
      commands.push(summarizeReCommand(result, 0));
      await sleep(1_000);
      result = await runRe(["-c", target.reContext, "-o", "json", "get", "projects"]);
    }

    const projects = result.parsedLines.filter((project) => String(project.name || "").endsWith("-ixp"));
    commands.push(summarizeReCommand(result, projects.length));

    if (result.exitCode !== 0) {
      return {
        rows: [],
        commands,
        error: result.error || result.stderr || "re project list failed",
      };
    }

    return { rows: projects, commands };
  } catch (error) {
    return {
      rows: [],
      commands: [
        {
          command: `re -c ${target.reContext || "<missing>"} -o json get projects`,
          ok: false,
          count: 0,
          durationMs: 0,
          code: "ReinferParseError",
          exitCode: 1,
          message: String(error.message || error),
        },
      ],
      error: String(error.message || error),
    };
  }
}

function safeJsonObject(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function auditCreatedAtById(rows, entityName) {
  const byId = new Map();
  const byKey = new Map();
  const byName = new Map();

  for (const row of rows) {
    const createdAt = row.ExecutionTime || "";
    if (!createdAt) continue;
    const entities = Array.isArray(row.Entities) ? row.Entities : [];
    const relevant = entities.filter((entity) => !entityName || entity.EntityName === entityName);
    const sources = relevant.length > 0 ? relevant : entities;
    for (const entity of sources) {
      const custom = safeJsonObject(entity.CustomData);
      const ids = [row.EntityId, entity.EntityId, custom.Id, custom.BucketId].filter((id) => id !== undefined && id !== null && id !== "");
      for (const id of ids) {
        if (!byId.has(String(id))) byId.set(String(id), createdAt);
      }
      for (const key of [custom.Key, custom.Identifier].filter(Boolean)) {
        if (!byKey.has(String(key))) byKey.set(String(key), createdAt);
      }
      for (const name of [row.DisplayName, custom.Name, custom.FullyQualifiedName, custom.FolderPath].filter(Boolean)) {
        if (!byName.has(String(name).toLowerCase())) byName.set(String(name).toLowerCase(), createdAt);
      }
    }
  }

  return { byId, byKey, byName };
}

function getFolderCreatedAt(folder, audit) {
  return (
    audit.byKey.get(String(folder.Key || "")) ||
    audit.byId.get(String(folder.Id || "")) ||
    audit.byName.get(String(folder.Path || "").toLowerCase()) ||
    audit.byName.get(String(folder.Name || "").toLowerCase()) ||
    ""
  );
}

function getBucketCreatedAt(bucket, audit) {
  return (
    audit.byId.get(String(bucket.Id || "")) ||
    audit.byKey.get(String(bucket.Identifier || bucket.Key || "")) ||
    audit.byName.get(String(bucket.Name || "").toLowerCase()) ||
    ""
  );
}

function timelineTicks(window) {
  if (!window.valid) return [];
  const ticks = [];
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  for (let current = startMs; current <= endMs; current += 30 * 60 * 1000) {
    ticks.push(new Date(current).toISOString());
  }
  if (ticks[ticks.length - 1] !== new Date(endMs).toISOString()) {
    ticks.push(new Date(endMs).toISOString());
  }
  return ticks;
}

function createdEvents(rows, createdKey, labelKey) {
  return rows
    .map((row) => ({
      at: row[createdKey] || "",
      label: row[labelKey] || row.name || row.title || "",
    }))
    .filter((event) => !Number.isNaN(Date.parse(event.at)));
}

function cumulativeSeries(id, label, color, events, ticks, window) {
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  const eventTimes = events
    .map((event) => Date.parse(event.at))
    .filter((time) => !Number.isNaN(time) && time >= startMs && time <= endMs)
    .sort((a, b) => a - b);

  return {
    id,
    label,
    color,
    points: ticks.map((tick) => {
      const tickMs = Date.parse(tick);
      return {
        tick,
        value: eventTimes.filter((time) => time <= tickMs).length,
      };
    }),
  };
}

function buildTimeline(folders, buckets, codedWebApps, ixpProjects, window) {
  const ticks = timelineTicks(window);
  if (ticks.length === 0) {
    return { ticks: [], series: [], unplotted: { folders: 0, buckets: 0, codedWebApps: 0, ixpProjects: 0 } };
  }

  const folderEvents = createdEvents(folders, "createdAt", "path");
  const bucketEvents = createdEvents(buckets, "createdAt", "name");
  const codedAppEvents = createdEvents(codedWebApps, "published", "title");
  const ixpEvents = createdEvents(ixpProjects, "createdAt", "title");

  return {
    ticks,
    series: [
      cumulativeSeries("folders", "Folders", "#FA4616", folderEvents, ticks, window),
      cumulativeSeries("buckets", "Buckets", "#0BA2B3", bucketEvents, ticks, window),
      cumulativeSeries("codedWebApps", "Coded Web Apps", "#1E6482", codedAppEvents, ticks, window),
      cumulativeSeries("ixpProjects", "IXP", "#5BCBDE", ixpEvents, ticks, window),
    ],
    unplotted: {
      folders: folders.filter((row) => !row.createdAt).length,
      buckets: buckets.filter((row) => !row.createdAt).length,
      codedWebApps: codedWebApps.filter((row) => !row.published).length,
      ixpProjects: ixpProjects.filter((row) => !row.createdAt).length,
    },
  };
}

async function refreshPulse(target, window) {
  const startedAt = new Date();
  const commands = [];
  const key = cacheKey(target, window);
  const existing = pulseCache.get(key) || {};

  try {
    const login = await runUip(["login", "status", "--output", "json"]);
    commands.push(summarizeCommand(login));
    const activeContext = assertTarget(login, target);

    const folders = await listAll(["or", "folders", "list", "--all"]);
    const buckets = await listAll(["or", "buckets", "list", "--all-folders", "--all-fields"]);
    const packages = await listAll(["or", "packages", "list"]);
    const folderCreates = window.valid
      ? await listAll(["or", "audit-logs", "list", "--component", "Folders", "--action", "Create", "--created-after", window.start, "--created-before", window.end])
      : { rows: [], commands: [] };
    const bucketCreates = window.valid
      ? await listAll(["or", "audit-logs", "list", "--component", "Buckets", "--action", "Create", "--created-after", window.start, "--created-before", window.end])
      : { rows: [], commands: [] };
    const ixpProjects = await listIxpProjects(target);
    const codedApps = packages.rows.filter((item) => item.PackageType === "WebApp");
    commands.push(
      ...folders.commands,
      ...buckets.commands,
      ...packages.commands,
      ...folderCreates.commands,
      ...bucketCreates.commands,
      ...ixpProjects.commands,
    );

    const folderAudit = auditCreatedAtById(folderCreates.rows, "UiOrganizationUnit");
    const bucketAudit = auditCreatedAtById(bucketCreates.rows, "UiBucket");
    const normalizedFolders = folders.rows.map((folder) => ({
      key: folder.Key || "",
      id: folder.Id ?? "",
      name: folder.Name || "",
      path: folder.Path || folder.Name || "",
      type: folder.Type || folder.FolderType || "",
      feedType: folder.FeedType || "",
      permissionModel: folder.PermissionModel || "",
      description: folder.Description || "",
      createdAt: getFolderCreatedAt(folder, folderAudit),
      url: foldersUrl(target),
    }));
    const normalizedBuckets = buckets.rows.map((bucket) => ({
      key: bucket.Identifier || bucket.Key || "",
      id: bucket.Id ?? "",
      name: bucket.Name || "",
      description: bucket.Description || "",
      foldersCount: bucket.FoldersCount ?? "",
      options: bucket.Options || "",
      encrypted: Boolean(bucket.Encrypted),
      createdAt: getBucketCreatedAt(bucket, bucketAudit),
      url: bucketsUrl(target),
    }));
    const normalizedCodedApps = codedApps.map((app) => ({
      title: app.Title || app.Id || "",
      id: app.Id || "",
      url: codedWebAppUrl(activeContext.organization, app.Id || app.Title || ""),
      version: app.Version || "",
      published: app.Published || "",
      authors: app.Authors || "",
      description: app.Description || "",
      isLatestVersion: Boolean(app.IsLatestVersion),
    }));
    const normalizedIxpProjects = ixpProjects.rows.map((project) => ({
      id: project.id || project.Id || "",
      name: project.name || project.Name || "",
      title: project.title || project.Title || project.name || project.Name || "",
      createdAt: project.created_at || project.CreatedAt || "",
      updatedAt: project.updated_at || project.UpdatedAt || "",
      description: project.description || project.Description || "",
      url: ixpProjectUrl(target, project.name || project.Name || ""),
    }));

    const pulse = {
      ok: true,
      paused: false,
      stale: false,
      target: publicTarget(target),
      warnings: ixpProjects.error ? [`IXP/Reinfer projects list failed: ${ixpProjects.error}`] : [],
      activeContext,
      window,
      updatedAt: new Date().toISOString(),
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      durationMs: Date.now() - startedAt.getTime(),
      counts: {
        folders: normalizedFolders.length,
        buckets: normalizedBuckets.length,
        codedWebApps: normalizedCodedApps.length,
        ixpProjects: normalizedIxpProjects.length,
        standardFolders: normalizedFolders.filter((folder) => folder.type === "Standard").length,
        uniqueBucketNames: uniqueValues(normalizedBuckets, "name"),
      },
      resourceLinks: { folders: foldersUrl(target), buckets: bucketsUrl(target) },
      timeline: buildTimeline(normalizedFolders, normalizedBuckets, normalizedCodedApps, normalizedIxpProjects, window),
      folders: normalizedFolders,
      buckets: normalizedBuckets,
      codedWebApps: normalizedCodedApps,
      ixpProjects: normalizedIxpProjects,
      commands,
    };
    pulseCache.set(key, { cachedPulse: pulse, lastGoodPulse: pulse, refreshPromise: null });
    return pulse;
  } catch (error) {
    if (existing.lastGoodPulse) {
      const stalePulse = {
        ...existing.lastGoodPulse,
        ok: false,
        paused: false,
        stale: true,
        updatedAt: new Date().toISOString(),
        refreshIntervalMs: REFRESH_INTERVAL_MS,
        durationMs: Date.now() - startedAt.getTime(),
        error: String(error.message || error),
        commands: commands.length > 0 ? commands : existing.lastGoodPulse.commands,
      };
      pulseCache.set(key, { ...existing, cachedPulse: stalePulse, refreshPromise: null });
      return stalePulse;
    }

    const failedPulse = {
      ok: false,
      paused: false,
      stale: true,
      target: publicTarget(target),
      activeContext: null,
      window,
      updatedAt: new Date().toISOString(),
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      durationMs: Date.now() - startedAt.getTime(),
      error: String(error.message || error),
      commands,
      counts: { folders: 0, buckets: 0, codedWebApps: 0, ixpProjects: 0, standardFolders: 0, uniqueBucketNames: 0 },
      resourceLinks: { folders: foldersUrl(target), buckets: bucketsUrl(target) },
      timeline: buildTimeline([], [], [], [], window),
      folders: [],
      buckets: [],
      codedWebApps: [],
      ixpProjects: [],
    };
    pulseCache.set(key, { cachedPulse: failedPulse, lastGoodPulse: null, refreshPromise: null });
    return failedPulse;
  }
}

async function getPulse(options = {}) {
  const target = await getTarget(options.targetId);
  const window = resolveWindow(target, options.start, options.end);
  const key = cacheKey(target, window);
  const existing = pulseCache.get(key) || {};
  const isManual = options.mode === "manual";

  if (!isManual && (!window.valid || window.state !== "active")) {
    return existing.cachedPulse
      ? { ...existing.cachedPulse, paused: true, window, message: window.message }
      : emptyPulse(target, window, window.message);
  }

  if (!options.force && existing.cachedPulse) {
    const isFresh = Date.now() - Date.parse(existing.cachedPulse.updatedAt) < REFRESH_INTERVAL_MS;
    if (!isFresh && !existing.refreshPromise) {
      const refreshPromise = refreshPulse(target, window).finally(() => {
        const current = pulseCache.get(key) || {};
        pulseCache.set(key, { ...current, refreshPromise: null });
      });
      pulseCache.set(key, { ...existing, refreshPromise });
    }
    return existing.cachedPulse;
  }

  if (!existing.refreshPromise) {
    const refreshPromise = refreshPulse(target, window).finally(() => {
      const current = pulseCache.get(key) || {};
      pulseCache.set(key, { ...current, refreshPromise: null });
    });
    pulseCache.set(key, { ...existing, refreshPromise });
    return refreshPromise;
  }

  return existing.refreshPromise;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  if (url.pathname === "/") {
    const html = await readFile(path.join(__dirname, "dashboard.html"), "utf8");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(html);
    return;
  }

  if (url.pathname === "/api/pulse") {
    const pulse = await getPulse({
      targetId: url.searchParams.get("target") || "",
      start: url.searchParams.get("start") || "",
      end: url.searchParams.get("end") || "",
      mode: url.searchParams.get("mode") || "auto",
      force: url.searchParams.get("force") === "1",
    });
    sendJson(response, pulse.ok ? 200 : 503, pulse);
    return;
  }

  if (url.pathname === "/api/targets") {
    const targets = await loadTargets();
    sendJson(response, 200, { targets: targets.map(publicTarget), refreshIntervalMs: REFRESH_INTERVAL_MS, maxWindowMs: MAX_WINDOW_MS });
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Start with TENANT_PULSE_PORT=<port> npm run tenant:pulse.`);
  } else {
    console.error(`Unable to start tenant pulse dashboard: ${error.message || error}`);
  }
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Tenant pulse dashboard: http://127.0.0.1:${PORT}`);
  void getPulse({ mode: "auto", force: false });
});
