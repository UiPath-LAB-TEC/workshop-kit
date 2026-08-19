#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import {getTarget} from './workshop-target.mjs';

const PREFIX = '[tenant-access]';
const DEFAULT_TIMEOUT_MS = 30_000;
let passCount = 0;
let warningCount = 0;
const checkResults = [];
const remediationCommands = [];
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
    return;
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
  if (tenant) {
    checkIxpService(tenant, tenantId);
  }

  const groups = runUip('group lookup', ['admin', 'groups', 'list']);
  if (!groups) {
    return;
  }

  const tenantName = value(tenantSummary, 'Name', 'name');
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
  console.log(
    `${PREFIX} Complete with ${passCount} pass${passCount === 1 ? '' : 'es'} and ${warningCount} warning${warningCount === 1 ? '' : 's'}; this check never blocks the build.`,
  );
  process.exitCode = 0;
}
