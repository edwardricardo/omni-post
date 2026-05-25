/**
 * @file OidcConfiguration.ts
 * @description Domain entity representing OpenID Connect SSO configuration for an account.
 *              Holds issuer URL, client credentials, scopes, attribute mappings, and activation state.
 *              No framework dependencies -- pure domain logic.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Attribute mapping shape -- maps OIDC UserInfo claims to internal user fields.
 * Must always include at least the 'email' key.
 */
export interface OidcAttributeMapping {
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  [key: string]: string | undefined;
}

/**
 * Properties required to construct / reconstitute an OidcConfiguration entity.
 */
export interface OidcConfigurationProps {
  id: string;
  accountId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  attributeMapping: OidcAttributeMapping;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new OidcConfiguration via the static factory.
 */
export interface CreateOidcConfigurationInput {
  id: string;
  accountId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  attributeMapping: OidcAttributeMapping;
}

export class OidcConfiguration {
  private readonly props: OidcConfigurationProps;

  private constructor(props: OidcConfigurationProps) {
    this.props = props;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * @method create
   * @description Validates input and creates a new OidcConfiguration.
   *   - issuerUrl must start with https://
   *   - clientId must not be empty
   *   - clientSecret must not be empty
   *   - attributeMapping must contain an 'email' key with a non-empty value
   */
  static create(input: CreateOidcConfigurationInput): Result<OidcConfiguration, InvalidValueError> {
    // Validate issuerUrl starts with https://
    if (!input.issuerUrl || !input.issuerUrl.startsWith("https://")) {
      return err(
        new InvalidValueError("issuerUrl", input.issuerUrl, "Issuer URL must start with https://")
      );
    }

    // Validate clientId not empty
    if (!input.clientId || input.clientId.trim().length === 0) {
      return err(new InvalidValueError("clientId", "[REDACTED]", "Client ID cannot be empty"));
    }

    // Validate clientSecret not empty
    if (!input.clientSecret || input.clientSecret.trim().length === 0) {
      return err(
        new InvalidValueError("clientSecret", "[REDACTED]", "Client secret cannot be empty")
      );
    }

    // Validate attributeMapping has 'email' key
    if (
      !input.attributeMapping ||
      typeof input.attributeMapping !== "object" ||
      !("email" in input.attributeMapping) ||
      !input.attributeMapping.email
    ) {
      return err(
        new InvalidValueError(
          "attributeMapping",
          input.attributeMapping,
          "Attribute mapping must include an 'email' key with a non-empty value"
        )
      );
    }

    const now = new Date();
    return ok(
      new OidcConfiguration({
        id: input.id,
        accountId: input.accountId,
        issuerUrl: input.issuerUrl,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        scopes: input.scopes ?? ["openid", "email", "profile"],
        attributeMapping: input.attributeMapping,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Reconstitute from persistence
  // ---------------------------------------------------------------------------

  /**
   * @method reconstitute
   * @description Recreates an OidcConfiguration from persisted data. No validation -- trusts DB.
   */
  static reconstitute(props: OidcConfigurationProps): OidcConfiguration {
    return new OidcConfiguration(props);
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get issuerUrl(): string {
    return this.props.issuerUrl;
  }
  get clientId(): string {
    return this.props.clientId;
  }
  get clientSecret(): string {
    return this.props.clientSecret;
  }
  get scopes(): string[] {
    return [...this.props.scopes];
  }
  get attributeMapping(): OidcAttributeMapping {
    return { ...this.props.attributeMapping };
  }
  get isActive(): boolean {
    return this.props.isActive;
  }
  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }
  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * @method replaceClientSecret
   * @description Updates the OIDC client secret in-place after a successful
   *   handshake test against the IdP. Caller is responsible for performing
   *   the handshake before invoking this method — the entity only enforces
   *   the non-empty invariant.
   */
  replaceClientSecret(newSecret: string): Result<void, InvalidValueError> {
    if (!newSecret || newSecret.trim().length === 0) {
      return err(
        new InvalidValueError("clientSecret", "[REDACTED]", "Client secret cannot be empty")
      );
    }
    this.props.clientSecret = newSecret;
    this.props.updatedAt = new Date();
    return ok(undefined);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * @method toJSON
   * @description Returns a plain-object representation. ClientSecret is masked for safety.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      accountId: this.props.accountId,
      issuerUrl: this.props.issuerUrl,
      clientId: this.props.clientId,
      clientSecret: "***MASKED***",
      scopes: this.props.scopes,
      attributeMapping: this.props.attributeMapping,
      isActive: this.props.isActive,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }
}
