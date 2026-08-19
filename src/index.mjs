export {getTarget, getTargetName} from './config/workshop-target.mjs';
export {
  BASE_FIELDS,
  readTargetsConfig,
  resolveFields,
  tokenToFieldMap,
  tokenValueMap,
  workshopPayload,
} from './config/workshop-fields.mjs';
export {createWorkshopConfig} from './config/createWorkshopConfig.mjs';
export {agentsBuild, agentsCheck, agentsInit} from './commands/agents-build.mjs';
