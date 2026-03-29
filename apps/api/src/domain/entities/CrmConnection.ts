/**
 * @file CrmConnection.ts
 * @description Domain entity for CRM connections. Validates platform and token constraints,
 *              manages token expiry, and masks sensitive data in serialization.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";

const VALID_PLATFORMS = ["HUBSPOT", "SALESFORCE"] as const;
export type CrmPlatformValue = (typeof VALID_PLATFORMS)[number];

export interface CrmConnectionProps {
  readonly id: string;
  readonly accountId: string;
  readonly platform: CrmPlatformValue;
  readonly isActive: boolean;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenExpiresAt?: Date;
  readonly portalId?: string;
  readonly instanceUrl?: string;
  readonly sandboxMode: boolean;
  readonly syncContacts: boolean;
  readonly syncActivities: boolean;
  readonly lastSyncAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateCrmConnectionInput {
  accountId: string;
  platform: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  portalId?: string;
  instanceUrl?: string;
  sandboxMode?: boolean;
  syncContacts?: boolean;
  syncActivities?: boolean;
}

export class CrmConnectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmConnectionValidationError";
  }
}

export class CrmConnection {
  private constructor(private readonly props: CrmConnectionProps) {}

  get id(): string {
    return this.props.id;
  }
  get accountId(): string {
    return this.props.accountId;
  }
  get platform(): CrmPlatformValue {
    return this.props.platform;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }
  get accessToken(): string {
    return this.props.accessToken;
  }
  get refreshToken(): string | undefined {
    return this.props.refreshToken;
  }
  get tokenExpiresAt(): Date | undefined {
    return this.props.tokenExpiresAt;
  }
  get portalId(): string | undefined {
    return this.props.portalId;
  }
  get instanceUrl(): string | undefined {
    return this.props.instanceUrl;
  }
  get sandboxMode(): boolean {
    return this.props.sandboxMode;
  }
  get syncContacts(): boolean {
    return this.props.syncContacts;
  }
  get syncActivities(): boolean {
    return this.props.syncActivities;
  }
  get lastSyncAt(): Date | undefined {
    return this.props.lastSyncAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * @method create
   * @description Creates a new CrmConnection entity. Validates platform and accessToken.
   * @param input - CRM connection creation parameters
   * @returns Result with CrmConnection on success, CrmConnectionValidationError on failure
   */
  static create(
    input: CreateCrmConnectionInput
  ): Result<CrmConnection, CrmConnectionValidationError> {
    if (!input.accountId) {
      return err(new CrmConnectionValidationError("accountId is required"));
    }

    if (!VALID_PLATFORMS.includes(input.platform as CrmPlatformValue)) {
      return err(
        new CrmConnectionValidationError(`platform must be one of: ${VALID_PLATFORMS.join(", ")}`)
      );
    }

    if (!input.accessToken || input.accessToken.trim().length === 0) {
      return err(new CrmConnectionValidationError("accessToken must not be empty"));
    }

    const now = new Date();
    return ok(
      new CrmConnection({
        id: "",
        accountId: input.accountId,
        platform: input.platform as CrmPlatformValue,
        isActive: true,
        accessToken: input.accessToken,
        ...(input.refreshToken !== undefined && { refreshToken: input.refreshToken }),
        ...(input.tokenExpiresAt !== undefined && { tokenExpiresAt: input.tokenExpiresAt }),
        ...(input.portalId !== undefined && { portalId: input.portalId }),
        ...(input.instanceUrl !== undefined && { instanceUrl: input.instanceUrl }),
        sandboxMode: input.sandboxMode ?? false,
        syncContacts: input.syncContacts ?? true,
        syncActivities: input.syncActivities ?? true,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  /**
   * @method reconstitute
   * @description Reconstitutes a CrmConnection from persisted data. No validation.
   */
  static reconstitute(props: CrmConnectionProps): CrmConnection {
    return new CrmConnection(props);
  }

  /**
   * @method isTokenExpired
   * @description Returns true when the access token has expired based on tokenExpiresAt.
   */
  isTokenExpired(): boolean {
    if (!this.props.tokenExpiresAt) {
      return false;
    }
    return new Date() >= this.props.tokenExpiresAt;
  }

  /**
   * @method updateTokens
   * @description Returns a new CrmConnection with updated token data.
   */
  updateTokens(data: {
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
  }): CrmConnection {
    return new CrmConnection({
      ...this.props,
      accessToken: data.accessToken,
      ...(data.refreshToken !== undefined && { refreshToken: data.refreshToken }),
      ...(data.tokenExpiresAt !== undefined && { tokenExpiresAt: data.tokenExpiresAt }),
      updatedAt: new Date(),
    });
  }

  /**
   * @method markSynced
   * @description Returns a new CrmConnection with lastSyncAt set to now.
   */
  markSynced(): CrmConnection {
    return new CrmConnection({
      ...this.props,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * @method deactivate
   * @description Returns a new CrmConnection with isActive set to false.
   */
  deactivate(): CrmConnection {
    return new CrmConnection({
      ...this.props,
      isActive: false,
      updatedAt: new Date(),
    });
  }

  /**
   * @method toJSON
   * @description Serializes the connection with tokens masked for safe logging.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      accountId: this.props.accountId,
      platform: this.props.platform,
      isActive: this.props.isActive,
      accessToken: "***MASKED***",
      refreshToken: this.props.refreshToken ? "***MASKED***" : undefined,
      ...(this.props.tokenExpiresAt !== undefined && {
        tokenExpiresAt: this.props.tokenExpiresAt,
      }),
      ...(this.props.portalId !== undefined && { portalId: this.props.portalId }),
      ...(this.props.instanceUrl !== undefined && { instanceUrl: this.props.instanceUrl }),
      sandboxMode: this.props.sandboxMode,
      syncContacts: this.props.syncContacts,
      syncActivities: this.props.syncActivities,
      ...(this.props.lastSyncAt !== undefined && { lastSyncAt: this.props.lastSyncAt }),
      createdAt: this.props.createdAt,
      updatedAt: this.props.updatedAt,
    };
  }
}
