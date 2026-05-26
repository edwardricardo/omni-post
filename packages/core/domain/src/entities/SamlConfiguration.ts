/**
 * @file SamlConfiguration.ts
 * @description Domain entity representing SAML 2.0 SSO configuration for an account.
 *              Holds IdP metadata, SP entity ID, attribute mappings, and activation state.
 *              No framework dependencies -- pure domain logic.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { InvalidValueError } from "../errors/index.js";

/**
 * Attribute mapping shape -- maps SAML assertion attributes to internal user fields.
 * Must always include at least the 'email' key.
 */
export interface SamlAttributeMapping {
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  [key: string]: string | undefined;
}

/**
 * Properties required to construct / reconstitute a SamlConfiguration entity.
 */
export interface SamlConfigurationProps {
  id: string;
  accountId: string;
  entityId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: SamlAttributeMapping;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new SamlConfiguration via the static factory.
 */
export interface CreateSamlConfigurationInput {
  id: string;
  accountId: string;
  entityId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  attributeMapping: SamlAttributeMapping;
}

export class SamlConfiguration {
  private readonly props: SamlConfigurationProps;

  private constructor(props: SamlConfigurationProps) {
    this.props = props;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * @method create
   * @description Validates input and creates a new SamlConfiguration.
   *   - idpSsoUrl must start with https://
   *   - idpCertificate must not be empty
   *   - attributeMapping must contain an 'email' key
   */
  static create(input: CreateSamlConfigurationInput): Result<SamlConfiguration, InvalidValueError> {
    // Validate idpSsoUrl starts with https://
    if (!input.idpSsoUrl || !input.idpSsoUrl.startsWith("https://")) {
      return err(
        new InvalidValueError("idpSsoUrl", input.idpSsoUrl, "IdP SSO URL must start with https://")
      );
    }

    // Validate idpCertificate not empty
    if (!input.idpCertificate || input.idpCertificate.trim().length === 0) {
      return err(
        new InvalidValueError("idpCertificate", "[REDACTED]", "IdP certificate cannot be empty")
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
      new SamlConfiguration({
        id: input.id,
        accountId: input.accountId,
        entityId: input.entityId,
        idpEntityId: input.idpEntityId,
        idpSsoUrl: input.idpSsoUrl,
        idpCertificate: input.idpCertificate,
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
   * @description Recreates a SamlConfiguration from persisted data. No validation -- trusts DB.
   */
  static reconstitute(props: SamlConfigurationProps): SamlConfiguration {
    return new SamlConfiguration(props);
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
  get entityId(): string {
    return this.props.entityId;
  }
  get idpEntityId(): string {
    return this.props.idpEntityId;
  }
  get idpSsoUrl(): string {
    return this.props.idpSsoUrl;
  }
  get idpCertificate(): string {
    return this.props.idpCertificate;
  }
  get attributeMapping(): SamlAttributeMapping {
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
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * @method toJSON
   * @description Returns a plain-object representation. Certificate is truncated for safety.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      accountId: this.props.accountId,
      entityId: this.props.entityId,
      idpEntityId: this.props.idpEntityId,
      idpSsoUrl: this.props.idpSsoUrl,
      idpCertificate: this.props.idpCertificate.substring(0, 40) + "...[TRUNCATED]",
      attributeMapping: this.props.attributeMapping,
      isActive: this.props.isActive,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }
}
