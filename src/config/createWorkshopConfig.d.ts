import type {Config} from '@docusaurus/types';

/** A field declared in config/workshop-targets.json beyond the shared four. */
export type ExtraFieldDeclaration = {
  type: 'string';
  /** The {{WORKSHOP_*}} token that renders this field. */
  token: string;
};

export type WorkshopTarget = {
  siteUrl: string;
  baseUrl: string;
  /** Run the advisory tenant-access check for this target. Defaults to false. */
  requiresTenantAccess?: boolean;
  workshop: {
    uipathOrgName: string;
    uipathTenantName: string;
    uipathTenantUrl: string;
    orchestratorParentFolder: string;
  } & Record<string, string>;
  codedApp: {
    name: string;
    description?: string;
  };
};

export type WorkshopTargetsConfig = {
  title: string;
  tagline: string;
  /** `<org>/<repo>`, e.g. `UiPath-LAB-TEC/maestro-workshop`. */
  repo: string;
  /** Footer "Docs" link label. Defaults to "Workshop Docs". */
  docsLabel?: string;
  defaultTarget: string;
  extraFields?: Record<string, ExtraFieldDeclaration>;
  targets: Record<string, WorkshopTarget>;
};

export type CreateWorkshopConfigOverrides = {
  title?: string;
  tagline?: string;
  repo?: string;
  docsLabel?: string;
  /** Replaces the kit stylesheet. Add a product stylesheet alongside it, don't drop it. */
  customCss?: string[];
  /** Last-resort escape hatch for a workshop that needs to alter the generated config. */
  extend?: (config: Config) => Config;
};

export function createWorkshopConfig(overrides?: CreateWorkshopConfigOverrides): Config;
export default createWorkshopConfig;
