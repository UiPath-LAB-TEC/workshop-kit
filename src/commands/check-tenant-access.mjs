#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import {getTarget} from '../config/workshop-target.mjs';

const PREFIX = '[tenant-access]';
const DEFAULT_TIMEOUT_MS = 30_000;
let passCount = 0;
let warningCount = 0;
let skipCount = 0;
const checkResults = [];
const capacityResults = [];
const remediationCommands = [];
const setupNotes = [];
const roleIdCache = new Map();

function pass(message) {
  passCount += 1;
  console.log(`${PREFIX} PASS  ${message}`);
}

function warn(message) {
  warningCount += 1;
  // Keep warnings on stdout so their order stays stable beside the build output.
  console.log(`${PREFIX} WARN  ${message}`);
}

/**
 * A check that could not run, as distinct from one that ran and found a problem.
 *
 * Missing local tooling is not a finding about the tenant. `re` is a separate
 * install from `uip` and most people building a workshop site will not have it,
 * so counting "you have not installed re" as a warning would put a permanent
 * warning on every build for a machine setup issue -- and a check that always
 * warns is a check nobody reads. Skips are reported and counted separately, and
 * carry a one-line note on how to make the check run next time.
 */
function skip(message, note = '') {
  skipCount += 1;
  console.log(`${PREFIX} SKIP  ${message}`);
  if (note) setupNotes.push(note);
}

function reportCheck({group, permission, expected, actual, passed, commands = [], advice = ''}) {
  checkResults.push({
    Group: group,
    Permission: permission,
    Expected: expected,
    Actual: actual,
    Result: passed ? 'PASS' : 'WARN',
  });

  if (passed) {
    pass(`${group} ${permission}: ${actual}.`);
  } else {
    warn(`${group} ${permission}: expected ${expected}; found ${actual}.`);
    if (commands.length > 0 || advice) {
      remediationCommands.push({group, permission, commands, advice});
    }
  }
}

function value(object, ...keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }
  return undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runUip(label, args) {
  const result = spawnSync('uip', [...args, '--output', 'json', '--log-level', 'error'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
  });

  if (result.error) {
    warn(`${label}: could not run the UiPath CLI (${result.error.message}).`);
    return null;
  }

  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    if (result.status !== 0) {
      warn(`${label}: UiPath CLI exited with status ${result.status}.`);
      return null;
    }
    warn(`${label}: UiPath CLI did not return JSON.`);
    return null;
  }

  if (result.status !== 0 || envelope.Result !== 'Success') {
    warn(`${label}: ${envelope.Message || envelope.Code || 'UiPath CLI request failed'}.`);
    return null;
  }

  return envelope.Data;
}

function findExact(items, name) {
  return asArray(items).find(
    (item) => String(value(item, 'Name', 'name') || '').toLowerCase() === name.toLowerCase(),
  );
}

function assignedRoleNames(data) {
  return asArray(data?.Results).flatMap((result) =>
    asArray(result?.RoleAssignmentDtos).map((assignment) => assignment.RoleName).filter(Boolean),
  );
}

function getAuthorizationRoleId({service, roleName, tenantId}) {
  const cacheKey = `${service}:${tenantId || 'organization'}:${roleName}`;
  if (roleIdCache.has(cacheKey)) {
    return roleIdCache.get(cacheKey);
  }

  const args = ['admin', 'authorization', 'roles', 'list', '--service', service, '--filter', roleName];
  if (service !== 'studio') {
    args.push('--tenant-id', tenantId);
  }

  const roles = runUip(`role lookup for ${roleName}`, args);
  const role = asArray(roles?.Results).find((item) => value(item, 'Name', 'name') === roleName);
  const roleId = value(role, 'Id', 'id');
  if (!roleId) {
    warn(`role lookup for ${roleName}: no role ID was returned, so no safe fix command was generated.`);
    return null;
  }

  roleIdCache.set(cacheKey, roleId);
  return roleId;
}

function authorizationAssignmentCommand({roleId, groupId, service, tenantId}) {
  const command = [
    'uip admin authorization roles assignments create',
    '--role-id',
    shellQuote(roleId),
    '--identity-id',
    shellQuote(groupId),
    '--identity-type Group',
    '--service',
    shellQuote(service),
  ];

  if (service !== 'studio') {
    command.push('--tenant-id', shellQuote(tenantId));
  }

  return command.join(' ');
}

function checkGroupRoles({group, groupName, permission, tenantId, service, requiredRoles}) {
  const args = [
    'admin',
    'authorization',
    'roles',
    'assignments',
    'list',
    '--identity-id',
    value(group, 'Id', 'id'),
    '--service',
    service,
    '--include-inherited',
  ];

  // Studio Web roles are organization-scoped; tenant-scoped role services
  // such as Document Understanding require the explicit tenant ID.
  if (service !== 'studio') {
    args.push('--tenant-id', tenantId);
  }

  const assignments = runUip(`${groupName} ${permission}`, args);

  if (!assignments) {
    reportCheck({
      group: groupName,
      permission,
      expected: requiredRoles.join(', '),
      actual: 'Unable to query',
      passed: false,
    });
    return;
  }

  const roles = assignedRoleNames(assignments);
  const missingRoles = requiredRoles.filter((role) => !roles.includes(role));
  if (missingRoles.length === 0) {
    reportCheck({
      group: groupName,
      permission,
      expected: requiredRoles.join(', '),
      actual: requiredRoles.join(', '),
      passed: true,
    });
    return;
  }

  reportCheck({
    group: groupName,
    permission,
    expected: requiredRoles.join(', '),
    actual: `${roles.join(', ') || 'no matching roles'} (missing ${missingRoles.join(', ')})`,
    passed: false,
    commands: missingRoles.flatMap((roleName) => {
      const roleId = getAuthorizationRoleId({service, roleName, tenantId});
      return roleId
        ? [
            authorizationAssignmentCommand({
              roleId,
              groupId: value(group, 'Id', 'id'),
              service,
              tenantId,
            }),
          ]
        : [];
    }),
  });
}

function checkDataFabricAccess({group, groupName, tenantId}) {
  const access = runUip(`${groupName} Data Fabric`, [
    'admin',
    'authorization',
    'check-access',
    value(group, 'Id', 'id'),
    '--service',
    'dataservice',
    '--tenant-id',
    tenantId,
  ]);

  if (!access) {
    reportCheck({
      group: groupName,
      permission: 'Data Fabric',
      expected: 'Any Data Service role',
      actual: 'Unable to query',
      passed: false,
    });
    return;
  }

  const hasDataService = asArray(access.GrantedServicesMetadata).some(
    (service) => value(service, 'ServiceName', 'serviceName') === 'DataService',
  );
  const roles = asArray(access.GrantedRolesMetadata)
    .map((role) => value(role, 'RoleName', 'roleName'))
    .filter(Boolean);
  const dataRoles = roles.filter((role) => role.startsWith('Data Service '));

  if (hasDataService && dataRoles.length > 0) {
    reportCheck({
      group: groupName,
      permission: 'Data Fabric',
      expected: 'Any Data Service role',
      actual: dataRoles.join(', '),
      passed: true,
    });
    return;
  }

  reportCheck({
    group: groupName,
    permission: 'Data Fabric',
    expected: 'Any Data Service role',
    actual: 'No effective Data Fabric/Data Service role',
    passed: false,
    advice:
      'Choose the intended Data Service level (Reader, Writer, or Administrator) before granting it. This validator accepts any effective Data Service role, so it does not guess or print an over-privileged command.',
  });
}

function checkIxpService(tenant, tenantId) {
  const services = asArray(value(tenant, 'TenantServiceInstances', 'tenantServiceInstances'));
  const reinfer = services.find(
    (service) => String(value(service, 'ServiceType', 'serviceType') || '').toLowerCase() === 'reinfer',
  );

  if (reinfer && String(value(reinfer, 'Status', 'status') || '').toLowerCase() === 'enabled') {
    reportCheck({
      group: 'Tenant',
      permission: 'IXP service',
      expected: 'reinfer enabled',
      actual: 'reinfer enabled',
      passed: true,
    });
    return true;
  }

  reportCheck({
    group: 'Tenant',
    permission: 'IXP service',
    expected: 'reinfer enabled',
    actual: reinfer ? String(value(reinfer, 'Status', 'status')) : 'reinfer not provisioned',
    passed: false,
    commands: [
      reinfer
        ? `uip admin tenants services enable --tenant-id ${shellQuote(tenantId)} --service reinfer`
        : `uip admin tenants services add --tenant-id ${shellQuote(tenantId)} --service reinfer`,
    ],
  });
  return false;
}

function checkParticipantsSharedFolderRole(group, groupName, folderPath) {
  const roles = runUip(`${groupName} ${folderPath} folder`, [
    'or',
    'roles',
    'user-roles',
    'list',
    groupName,
    '--type',
    'Group',
  ]);

  if (!roles) {
    reportCheck({
      group: groupName,
      permission: `${folderPath} folder`,
      expected: 'Folder Administrator',
      actual: 'Unable to query',
      passed: false,
    });
    return;
  }

  const hasFolderAdministrator = asArray(roles).some(
    (role) =>
      value(role, 'Scope', 'scope') === 'Folder' &&
      value(role, 'FolderPath', 'folderPath') === folderPath &&
      value(role, 'Role', 'role') === 'Folder Administrator',
  );

  reportCheck({
    group: groupName,
    permission: `${folderPath} folder`,
    expected: 'Folder Administrator',
    actual: hasFolderAdministrator ? 'Folder Administrator' : 'Folder Administrator not assigned',
    passed: hasFolderAdministrator,
    commands: hasFolderAdministrator ? [] : buildFolderAdministratorCommand({group, folderPath, roles}),
  });
}

function buildFolderAdministratorCommand({group, folderPath, roles}) {
  const currentFolderRoleNames = asArray(roles)
    .filter(
      (role) =>
        value(role, 'Scope', 'scope') === 'Folder' &&
        value(role, 'FolderPath', 'folderPath') === folderPath,
    )
    .map((role) => value(role, 'Role', 'role'))
    .filter(Boolean);
  const desiredRoleNames = [...new Set([...currentFolderRoleNames, 'Folder Administrator'])];
  const roleCatalog = runUip('folder role lookup', ['or', 'roles', 'list', '--limit', '200']);
  const roleKeys = desiredRoleNames.map((roleName) => {
    const role = findExact(roleCatalog, roleName);
    return value(role, 'Key', 'key');
  });

  if (roleKeys.some((key) => !key)) {
    warn('folder role lookup: could not resolve every existing folder role, so no replacement command was generated.');
    return [];
  }

  const principals = runUip('Orchestrator group principal lookup', [
    'or',
    'users',
    'list',
    '--username',
    value(group, 'Name', 'name'),
    '--all-fields',
  ]);
  const groupName = value(group, 'Name', 'name');
  const principal = asArray(principals).find((item) =>
    [value(item, 'Name', 'name'), value(item, 'FullName', 'fullName'), value(item, 'UserName', 'userName')]
      .filter(Boolean)
      .some((name) => String(name).toLowerCase() === String(groupName).toLowerCase()),
  );
  const principalKey = value(principal, 'Key', 'key');
  if (!principalKey) {
    warn('Orchestrator group principal lookup: no exact group key was returned, so no replacement command was generated.');
    return [];
  }

  return [
    [
      'uip or roles assign',
      '--user-key',
      shellQuote(principalKey),
      '--folder-path',
      shellQuote(folderPath),
      '--role-keys',
      shellQuote(roleKeys.join(',')),
    ].join(' '),
  ];
}

/**
 * Capacity defaults, used when a target declares no `capacity` block.
 *
 * Zero means "report the number, do not judge it": every workshop gets the
 * quota readout, and only a target that states what it needs gets a warning
 * when the tenant cannot supply it. Guessing a participant count would make
 * every unconfigured repo warn on a healthy tenant, which is how an advisory
 * check trains people to ignore it.
 */
const CAPACITY_DEFAULTS = {
  participants: 0,
  aiUnitsPerParticipant: 0,
  agentUnitsPerParticipant: 0,
  ixpQuotaPerParticipant: {},
};

/**
 * The licence summary covers every unit code in one response, so it is fetched
 * once and reused rather than re-requested per unit on every build.
 */
let licenceSummaryCache;
function licenceSummary() {
  if (licenceSummaryCache === undefined) {
    licenceSummaryCache = asArray(runUip('licence summary', ['platform', 'licenses', 'summary']));
  }
  return licenceSummaryCache;
}

function number(input) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Fixed locale so the output is identical on every machine and in CI logs. */
function formatUnits(input) {
  return Math.round(number(input)).toLocaleString('en-US');
}

/** `used` as a percentage of `limit`, for reading how close to the edge this is. */
function percentUsed(used, limit) {
  if (!(number(limit) > 0)) return 'n/a';
  return `${Math.round((number(used) / number(limit)) * 100)}%`;
}

/**
 * What to raise a quota to, given current usage and what the workshop needs.
 *
 * Current usage plus the full workshop need, not the shortfall: the existing
 * usage does not go away, so a ceiling raised by only the gap leaves exactly
 * zero headroom the moment the workshop finishes. A 20% margin on top absorbs
 * the next delivery and re-runs, and the result is rounded up so the number is
 * one a person is willing to paste into a quota request.
 */
function recommendedQuotaLimit({limit, used, need}) {
  const required = Math.ceil((number(used) + number(need)) * 1.2);
  const target = Math.max(required, number(limit));
  const magnitude = 10 ** Math.max(1, String(Math.floor(target)).length - 2);
  return Math.ceil(target / magnitude) * magnitude;
}

function reportCapacity({resource, metric, need, have, passed, recommend = null, commands = []}) {
  capacityResults.push({
    Resource: resource,
    Metric: metric,
    Needed: need === null ? 'not declared' : formatUnits(need),
    Available: formatUnits(have),
    Short: passed === false && need !== null ? formatUnits(need - have) : '',
    'Raise to': recommend === null ? '' : formatUnits(recommend),
    Result: passed === null ? 'INFO' : passed ? 'PASS' : 'WARN',
  });

  if (passed === null) {
    console.log(`${PREFIX} INFO  ${resource} ${metric}: ${formatUnits(have)} available.`);
    return;
  }
  if (passed) {
    pass(`${resource} ${metric}: ${formatUnits(have)} available, ${formatUnits(need)} needed.`);
    return;
  }
  warn(
    `${resource} ${metric}: ${formatUnits(have)} available but ${formatUnits(need)} needed — ` +
      `short by ${formatUnits(need - have)}` +
      (recommend === null ? '.' : `. Raise the limit to ${formatUnits(recommend)}.`),
  );
  if (commands.length > 0) {
    remediationCommands.push({group: resource, permission: metric, commands, advice: ''});
  }
}

/**
 * Consumable headroom for one unit code.
 *
 * Neither licence surface answers "can this workshop run" on its own.
 * `Available` is null for consumables in the summary, and `Allocated` is what
 * the org has handed to tenants rather than what is left; the consumables
 * report has no total-consumed column at all. So headroom is derived:
 * TotalUnitsInAccount minus everything consumed. Consumption draws on the
 * shared account pool, so a sibling tenant burning units constrains this one --
 * an org-wide figure is the honest one, not a tenant-only slice.
 *
 * Both surfaces are read because they disagree. Against the same 5,000,000-unit
 * AIU pool on the growthuipath org, the summary reported 3,675,583 consumed
 * while the per-tenant rows summed to 1,796,083 -- a 1,879,500 gap, most likely
 * consumption from tenants no longer in the report. AGU matched to the unit.
 * The larger figure wins: this check exists to stop a workshop running out of
 * units, and overstating headroom by 2.4x would defeat it. The gap is surfaced
 * rather than hidden, because a facilitator seeing one should know the account
 * has consumption the per-tenant breakdown cannot explain.
 */
function readConsumable(unitCode, unitLabel, tenantName) {
  const rows = asArray(
    runUip(`${unitLabel} consumables`, [
      'platform',
      'licenses',
      'consumables',
      'get',
      '--unit',
      unitCode,
    ]),
  );

  if (rows.length === 0) {
    return null;
  }

  const total = number(value(rows[0], 'TotalUnitsInAccount', 'totalUnitsInAccount'));
  // Repeated identically on every row of the report, so it must be counted once.
  const orgOnly = number(value(rows[0], 'ConsumedFromOrgWithoutTenant', 'consumedFromOrgWithoutTenant'));
  const perTenantConsumed =
    orgOnly +
    rows.reduce(
      (sum, row) =>
        sum +
        number(value(row, 'ConsumedFromTenantPool', 'consumedFromTenantPool')) +
        number(value(row, 'ConsumedFromOrgPool', 'consumedFromOrgPool')),
      0,
    );

  const summaryRow = licenceSummary().find(
    (row) => String(value(row, 'Code', 'code') || '').toUpperCase() === unitCode,
  );
  const summaryConsumed = summaryRow ? number(value(summaryRow, 'Used', 'used')) : null;

  const consumed =
    summaryConsumed === null ? perTenantConsumed : Math.max(summaryConsumed, perTenantConsumed);

  const tenantRow = rows.find(
    (row) =>
      String(value(row, 'TenantName', 'tenantName') || '').toLowerCase() ===
      String(tenantName).toLowerCase(),
  );

  return {
    total,
    consumed,
    perTenantConsumed,
    summaryConsumed,
    remaining: total - consumed,
    tenantConsumed: tenantRow
      ? number(value(tenantRow, 'ConsumedFromTenantPool', 'consumedFromTenantPool')) +
        number(value(tenantRow, 'ConsumedFromOrgPool', 'consumedFromOrgPool'))
      : null,
    endDate: value(rows[0], 'EndDate', 'endDate') || null,
  };
}

function checkConsumable({unitCode, unitLabel, tenantName, perParticipant, participants}) {
  const usage = readConsumable(unitCode, unitLabel, tenantName);
  if (!usage) {
    reportCheck({
      group: 'Tenant',
      permission: `${unitLabel} licensing`,
      expected: 'A consumables report',
      actual: 'Unable to query',
      passed: false,
    });
    return;
  }

  const need = perParticipant > 0 && participants > 0 ? perParticipant * participants : null;
  reportCapacity({
    resource: unitLabel,
    metric: 'remaining in account',
    need,
    have: usage.remaining,
    passed: need === null ? null : usage.remaining >= need,
  });

  console.log(
    `${PREFIX} INFO  ${unitLabel}: ${formatUnits(usage.total)} in the account, ` +
      `${formatUnits(usage.consumed)} consumed org-wide` +
      (usage.tenantConsumed === null
        ? `, no consumption recorded for ${tenantName}`
        : `, ${formatUnits(usage.tenantConsumed)} by ${tenantName}`) +
      (usage.endDate ? `; bundle ends ${String(usage.endDate).slice(0, 10)}` : '') +
      '.',
  );

  // Rounded, not exact: the API returns fractional units, and the two surfaces
  // agreeing to the unit still differ in the last float bit (149514.99999999997
  // against 149515), which an exact comparison reports as a divergence.
  if (
    usage.summaryConsumed !== null &&
    Math.round(usage.summaryConsumed) !== Math.round(usage.perTenantConsumed)
  ) {
    console.log(
      `${PREFIX} INFO  ${unitLabel}: the licence summary reports ` +
        `${formatUnits(usage.summaryConsumed)} consumed but the per-tenant breakdown sums to ` +
        `${formatUnits(usage.perTenantConsumed)}. Headroom above uses the larger figure.`,
    );
  }

  // A bundle that expires before delivery leaves a healthy-looking balance that
  // cannot be spent, so the date is checked rather than merely printed.
  if (usage.endDate && new Date(usage.endDate).getTime() < Date.now()) {
    warn(`${unitLabel}: the licence bundle ended ${String(usage.endDate).slice(0, 10)}.`);
  }
}

/**
 * Whether the `re` CLI exists on PATH at all.
 *
 * `re` ships separately from `uip` and most people building a workshop site will
 * not have it. That is a machine setup fact, not a finding about the tenant, so
 * everything downstream of a false here skips rather than warns.
 */
function reIsInstalled() {
  const result = spawnSync('re', ['--version'], {encoding: 'utf8', timeout: DEFAULT_TIMEOUT_MS});
  return !result.error && result.status === 0;
}

/**
 * Runs a `re` command and parses its JSONL output.
 *
 * A separate runner from runUip: `re` is a different CLI with no response
 * envelope, and `-o json` emits one object per line rather than an array.
 */
function runRe(label, args) {
  const result = spawnSync('re', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
  });

  if (result.error) {
    warn(`${label}: could not run the re CLI (${result.error.message}).`);
    return null;
  }

  if (result.status !== 0) {
    // stderr carries the actual API error (a 401 on a stale token, most often),
    // and without it the reader is left guessing at an exit code.
    const detail = String(result.stderr || '').trim().split(/\r?\n/).filter(Boolean).pop();
    warn(`${label}: re exited with status ${result.status}${detail ? ` — ${detail}` : ''}.`);
    return null;
  }

  const rows = [];
  for (const line of String(result.stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      warn(`${label}: re returned a line that is not JSON.`);
      return null;
    }
  }
  return rows;
}

/**
 * The org and tenant a URL addresses, as `<origin>/<org>/<tenant>`.
 *
 * Both the workshop target's Orchestrator URL and a `re` context endpoint carry
 * the same two path segments after the origin, differing only in the trailing
 * service segment (`orchestrator_` against `reinfer_`), so normalising to the
 * first two segments is what lets one be matched to the other.
 */
function orgTenantKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const [org, tenant] = url.pathname.split('/').filter(Boolean);
    if (!org || !tenant) return null;
    return `${url.origin}/${org}/${tenant}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The `re` context pointing at the same tenant as the workshop target.
 *
 * The context is matched rather than the endpoint being passed directly,
 * because the API token lives in the context: `re --endpoint <url>` with no
 * context has nothing to authenticate with. Contexts are read from the table
 * `re config ls` prints, deliberately NOT from the contexts file it stores them
 * in -- that file holds the tokens, and this check has no business opening it.
 */
function reContextForTarget(target) {
  const result = spawnSync('re', ['config', 'ls'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
  });

  if (result.error || result.status !== 0) return null;

  const contexts = [];
  for (const line of String(result.stdout).split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    const endpoint = columns.find((column) => column.startsWith('http'));
    if (!endpoint) continue;
    // The active context is marked with a leading arrow, so the name is the
    // first column that is neither the marker nor the endpoint.
    const name = columns.find((column) => column !== '->' && !column.startsWith('http'));
    if (name) contexts.push({name, endpoint});
  }

  // The same order `pulse` uses, so the two commands never disagree about which
  // context belongs to a target: an explicit RE_CONTEXT override, then the
  // established `UiPath_<org>_<tenant>` name.
  const explicit = process.env.RE_CONTEXT?.trim();
  if (explicit) {
    const match = contexts.find((context) => context.name === explicit);
    if (match) return match.name;
    warn(`IXP quotas: RE_CONTEXT is set to "${explicit}", but no re context has that name.`);
    return null;
  }

  const org = target.workshop?.uipathOrgName;
  const tenant = target.workshop?.uipathTenantName;
  if (org && tenant) {
    const inferred = `UiPath_${org}_${tenant}`;
    const match = contexts.find((context) => context.name === inferred);
    if (match) return match.name;
  }

  // Endpoint fallback, for the contexts that predate that convention -- most of
  // them, in practice. Matching on org+tenant rather than the exact URL because
  // the two differ in their trailing service segment and in stored trailing
  // slashes, neither of which changes which tenant is addressed.
  const wanted = orgTenantKey(target.workshop?.uipathTenantUrl);
  if (!wanted) return null;
  return contexts.find((context) => orgTenantKey(context.endpoint) === wanted)?.name || null;
}

/**
 * Reads IXP quotas through the `re` context that points at this tenant.
 *
 * Deliberately only this route. A token could be read from
 * `.env.deploy.<target>` and materialised into a temporary `--config-file`,
 * which works -- but it means this check handles a raw API key, writes it to
 * disk, and depends on `re`'s config file format staying put. `re config add`
 * is the supported way to hold Reinfer credentials, so the setup burden stays
 * with the operator and this check stays out of the secret-handling business.
 *
 * Both failure modes below are skips, not warnings: no `re` and no context are
 * facts about the machine this ran on, not findings about the tenant.
 */
function readIxpQuotas(target) {
  if (!reIsInstalled()) {
    skip(
      'IXP quotas: the re CLI is not installed, so IXP quotas were not checked.',
      'Install the re CLI to check IXP quotas -- they are a Reinfer surface and uip cannot read ' +
        'them. Everything else in this report ran normally.',
    );
    return null;
  }

  const context = reContextForTarget(target);
  if (!context) {
    const wanted = orgTenantKey(target.workshop?.uipathTenantUrl);
    skip(
      `IXP quotas: no re context points at ${wanted || 'this tenant'}, so IXP quotas were not checked.`,
      `Add a re context for this tenant: \`re config add --name <name> --endpoint ` +
        `${wanted ? `${wanted}/reinfer_/` : '<org>/<tenant>/reinfer_/'} --token <token>\`. ` +
        `Get the token from the IXP UI under Manage account > API tokens.`,
    );
    return null;
  }

  return runRe('IXP quotas', ['-c', context, '-o', 'json', 'get', 'quotas']);
}

/**
 * IXP quota headroom, read from the `re` CLI.
 *
 * IXP quotas are a Reinfer concept and are managed through `re`, not `uip`:
 * `re get quotas` returns each quota kind with its `hard_limit` and
 * `current_max_usage`, so sources, datasets, buckets, comments and extraction
 * predictions all come back with real discovered ceilings. Nothing here has to
 * be declared as a limit, which is the whole point -- an earlier version of this
 * check counted `uip ixp projects list` against a hand-written cap, and both
 * halves of that were wrong: `uip` cannot see these quotas at all, and the cap
 * was a guess at a number the tenant already knows.
 */
function checkIxpQuotas({target, participants, perParticipant, tenantId}) {
  const quotas = readIxpQuotas(target);
  if (!quotas) return;

  const seen = new Set();
  for (const quota of quotas) {
    const kind = String(value(quota, 'quota_kind') || '');
    if (!kind) continue;
    seen.add(kind);

    const limit = number(value(quota, 'hard_limit'));
    const used = number(value(quota, 'current_max_usage'));
    const free = limit - used;
    const perHead = number(perParticipant[kind]);
    const need = perHead > 0 && participants > 0 ? perHead * participants : null;
    const short = need === null ? false : free < need;

    reportCapacity({
      resource: `IXP ${kind}`,
      metric: 'free before the hard limit',
      need,
      have: free,
      passed: need === null ? null : !short,
      // What to raise the ceiling to, not merely that it is too low. The
      // shortfall alone is not the answer a facilitator needs -- they have to
      // put a number in a quota request, and it must cover current usage plus
      // the whole workshop, not just the gap.
      recommend: short ? recommendedQuotaLimit({limit, used, need}) : null,
      commands:
        short && tenantId
          ? [
              `re create quota --quota-kind ${shellQuote(kind)} --limit ` +
                `${recommendedQuotaLimit({limit, used, need})} --uipath-tenant-id ${shellQuote(tenantId)}`,
            ]
          : [],
    });
    console.log(
      `${PREFIX} INFO  IXP ${kind}: ${formatUnits(used)} of ${formatUnits(limit)} used ` +
        `(${percentUsed(used, limit)} of the limit).`,
    );
  }

  // A declared need for a quota kind the tenant does not report is almost
  // always a typo, and it would otherwise pass silently as an unchecked need.
  for (const kind of Object.keys(perParticipant)) {
    if (number(perParticipant[kind]) > 0 && !seen.has(kind)) {
      warn(
        `IXP quotas: capacity.ixpQuotaPerParticipant declares "${kind}", but this tenant reports ` +
          `no such quota. Known kinds here: ${[...seen].sort().join(', ') || 'none'}.`,
      );
    }
  }
}

function checkCapacity({target, tenantName, tenantId, ixpEnabled}) {
  const capacity = {...CAPACITY_DEFAULTS, ...(target.capacity || {})};
  const participants = number(capacity.participants);

  console.log(
    `\n${PREFIX} Capacity for ${tenantName}` +
      (participants > 0 ? ` at ${participants} participants` : ' (no participant count declared)') +
      '.',
  );

  checkConsumable({
    unitCode: 'AIU',
    unitLabel: 'AI Units',
    tenantName,
    participants,
    perParticipant: number(capacity.aiUnitsPerParticipant),
  });
  checkConsumable({
    unitCode: 'AGU',
    unitLabel: 'Agent Units',
    tenantName,
    participants,
    perParticipant: number(capacity.agentUnitsPerParticipant),
  });

  // Querying IXP on a tenant without the service returns an error that reads as
  // a capacity failure rather than what it is, so this is gated on enablement.
  if (ixpEnabled) {
    checkIxpQuotas({
      target,
      tenantId,
      participants,
      perParticipant: capacity.ixpQuotaPerParticipant || {},
    });
  } else {
    console.log(`${PREFIX} INFO  IXP capacity skipped: the reinfer service is not enabled on this tenant.`);
  }
}

function main() {
  const targetArg = process.argv[2];
  let targetName;
  let target;

  try {
    ({targetName, target} = getTarget(targetArg));
  } catch (error) {
    warn(`could not resolve the workshop target (${error.message}).`);
    return;
  }

  const expectedOrg = target.workshop.uipathOrgName;
  const expectedTenant = target.workshop.uipathTenantName;
  const parentFolder = target.workshop.orchestratorParentFolder;
  console.log(`${PREFIX} Checking ${targetName}: ${expectedOrg} / ${expectedTenant}. Warning-only mode.`);

  const login = runUip('login status', ['login', 'status']);
  if (login) {
    const activeOrg = value(login, 'Organization', 'organization');
    const activeTenant = value(login, 'Tenant', 'tenant');
    if (activeOrg === expectedOrg && activeTenant === expectedTenant) {
      pass('UiPath login matches the selected workshop target.');
    } else {
      warn(
        `UiPath login is ${activeOrg || 'unknown'} / ${activeTenant || 'unknown'}, not ${expectedOrg} / ${expectedTenant}.`,
      );
    }
  }

  const tenants = runUip('tenant lookup', ['admin', 'tenants', 'list', '--filter', expectedTenant]);
  const tenantSummary = findExact(tenants, expectedTenant);
  if (!tenantSummary) {
    warn(`tenant lookup: could not find ${expectedTenant} in the active organization.`);
    return;
  }

  const tenantId = value(tenantSummary, 'Id', 'id');
  if (!tenantId) {
    warn(`tenant lookup: ${expectedTenant} did not include a tenant ID.`);
    return;
  }

  const tenant = runUip('tenant services', ['admin', 'tenants', 'get', tenantId]);
  const ixpEnabled = tenant ? checkIxpService(tenant, tenantId) : false;

  const tenantName = value(tenantSummary, 'Name', 'name');
  checkCapacity({target, tenantName, tenantId, ixpEnabled});

  const groups = runUip('group lookup', ['admin', 'groups', 'list']);
  if (!groups) {
    return;
  }

  const participants = findExact(groups, `${tenantName}-Participants`);
  const facilitators = findExact(groups, `${tenantName}-Facilitators`);

  for (const [label, group, studioRoles] of [
    ['participants', participants, ['Studio Web Contributor']],
    ['facilitators', facilitators, ['Studio Web Administrator', 'Studio Web Contributor']],
  ]) {
    if (!group) {
      warn(`group lookup: ${tenantName}-${label[0].toUpperCase()}${label.slice(1)} was not found.`);
      continue;
    }

    const groupName = value(group, 'Name', 'name');
    checkGroupRoles({
      group,
      groupName,
      tenantId,
      service: 'documentunderstanding',
      requiredRoles: ['DU Administrator'],
      permission: 'Document Understanding',
    });
    checkDataFabricAccess({group, groupName, tenantId});
    checkGroupRoles({
      group,
      groupName,
      tenantId,
      service: 'studio',
      requiredRoles: studioRoles,
      permission: 'Studio Web',
    });

    if (label === 'participants') {
      checkParticipantsSharedFolderRole(group, groupName, parentFolder);
    }
  }
}

try {
  main();
} catch (error) {
  warn(`unexpected error: ${error.message}`);
} finally {
  if (checkResults.length > 0) {
    console.log(`\n${PREFIX} Permission checks`);
    console.table(checkResults);
  }
  if (capacityResults.length > 0) {
    console.log(`\n${PREFIX} Capacity checks`);
    console.table(capacityResults);
  }
  if (remediationCommands.length > 0) {
    console.log(`\n${PREFIX} Suggested fix commands (not executed)`);
    for (const remediation of remediationCommands) {
      console.log(`\n# ${remediation.group} — ${remediation.permission}`);
      for (const command of remediation.commands) {
        console.log(command);
      }
      if (remediation.advice) {
        console.log(`# ${remediation.advice}`);
      }
    }
  }
  if (setupNotes.length > 0) {
    console.log(`\n${PREFIX} To run the skipped checks next time`);
    for (const note of setupNotes) {
      console.log(`- ${note}`);
    }
  }
  console.log(
    `${PREFIX} Complete with ${passCount} pass${passCount === 1 ? '' : 'es'}, ` +
      `${warningCount} warning${warningCount === 1 ? '' : 's'}` +
      (skipCount > 0 ? ` and ${skipCount} skipped check${skipCount === 1 ? '' : 's'}` : '') +
      `; this check never blocks the build.`,
  );
  process.exitCode = 0;
}
