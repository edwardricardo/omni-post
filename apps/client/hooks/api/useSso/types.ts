/**
 * @file types.ts
 * @description Public types for SAML and OIDC SSO configuration hooks.
 * @layer infrastructure
 */

interface AttributeMapping {
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
}

export interface SamlConfig {
  id: string;
  accountId: string;
  entityId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: AttributeMapping;
  isActive: boolean;
}

export interface OidcConfig {
  id: string;
  accountId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  attributeMapping: AttributeMapping;
  isActive: boolean;
}

export interface ConfigureSamlInput {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: AttributeMapping;
}

export interface ConfigureOidcInput {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  attributeMapping: AttributeMapping;
}

export type SsoProvider = "saml" | "oidc";
