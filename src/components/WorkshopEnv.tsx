import React from 'react';
import CodeBlock from '@theme/CodeBlock';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

/**
 * The four shared fields exist in every workshop. Product-specific fields are
 * declared in config/workshop-targets.json under `extraFields` and arrive here
 * through customFields.workshop and customFields.workshopTokens, so adding one
 * no longer means editing this file.
 */
type BaseWorkshopConfig = {
  uipathOrgName: string;
  uipathTenantName: string;
  uipathTenantUrl: string;
  orchestratorParentFolder: string;
};

export type WorkshopConfig = BaseWorkshopConfig & Record<string, string>;
export type WorkshopField = keyof BaseWorkshopConfig | (string & {});

function useWorkshop(): {config: WorkshopConfig; tokenMap: Record<string, string>} {
  const {siteConfig} = useDocusaurusContext();
  const config = siteConfig.customFields?.workshop as WorkshopConfig | undefined;
  if (!config) {
    throw new Error(
      'Missing Docusaurus customFields.workshop. Build the site through createWorkshopConfig from @uipath-lab-tec/workshop-kit/config.',
    );
  }
  const tokenMap = (siteConfig.customFields?.workshopTokens ?? {}) as Record<string, string>;
  return {config, tokenMap};
}

function replaceWorkshopTokens(
  value: string,
  config: WorkshopConfig,
  tokenMap: Record<string, string>,
): string {
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token: string) => {
    const field = tokenMap[token];
    return field ? config[field] ?? match : match;
  });
}

export function WorkshopValue({field}: {field: WorkshopField}) {
  const {config} = useWorkshop();
  const value = config[field as string];
  if (value === undefined) {
    throw new Error(`Unknown workshop field "${String(field)}".`);
  }
  return <>{value}</>;
}

export function WorkshopLink({
  field,
  children,
}: {
  field?: WorkshopField;
  children?: React.ReactNode;
}) {
  const {config} = useWorkshop();
  const href = config[(field ?? 'uipathTenantUrl') as string];
  return <a href={href}>{children ?? href}</a>;
}

export function WorkshopImage({src, alt}: {src: string; alt: string}) {
  return <img src={useBaseUrl(src)} alt={alt} />;
}

export function WorkshopDownloadLink({
  href,
  label,
  className = 'button button--primary',
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <a className={className} href={useBaseUrl(href)} download>
      {label}
    </a>
  );
}

export function WorkshopCodeBlock({
  children,
  language = 'text',
}: {
  children: string;
  language?: string;
}) {
  const {config, tokenMap} = useWorkshop();
  return (
    <CodeBlock language={language}>
      {replaceWorkshopTokens(children, config, tokenMap)}
    </CodeBlock>
  );
}
