/**
 * @file Channel.ts
 * @description Domain entity representing a social media channel connected to a project — manages OAuth credentials, connection status, and provider metadata.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { ChannelId, ProjectId } from "../value-objects/EntityId.js";
import { Provider, type ProviderType } from "../value-objects/Provider.js";
import { InvalidValueError, InvariantViolationError } from "../errors/index.js";

/**
 * OAuth credentials for a channel
 */
export interface ChannelCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  scope?: string[];
}

/**
 * Connection status for a channel
 */
export const CONNECTION_STATUS = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  ERROR: "ERROR",
  EXPIRED: "EXPIRED",
  PENDING: "PENDING",
} as const;

export type ConnectionStatusValue = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

/**
 * Channel construction properties
 */
export interface ChannelProps extends EntityProps {
  projectId: ProjectId;
  provider: Provider;
  handle: string;
  credentials: ChannelCredentials;
  status?: ConnectionStatusValue;
  lastHealthCheck?: Date;
  errorCount?: number;
  lastError?: string;
}

/**
 * Channel creation input
 */
export interface CreateChannelInput {
  projectId: ProjectId;
  provider: ProviderType | Provider;
  handle: string;
  credentials: ChannelCredentials;
}

/**
 * Channel - Domain entity representing a social media account
 *
 * Invariants:
 * - A channel must have a valid provider
 * - A channel must have credentials with at least an access token
 * - Handle cannot be empty
 *
 * @example
 * const result = Channel.create({
 *   projectId: projectId,
 *   provider: 'X',
 *   handle: '@myhandle',
 *   credentials: { accessToken: 'token123' }
 * });
 */
export class Channel extends Entity<ChannelId> {
  private readonly _projectId: ProjectId;
  private readonly _provider: Provider;
  private _handle: string;
  private _credentials: ChannelCredentials;
  private _status: ConnectionStatusValue;
  private _lastHealthCheck: Date | undefined;
  private _errorCount: number;
  private _lastError: string | undefined;

  private constructor(id: ChannelId, props: ChannelProps) {
    super(id, props.createdAt);
    this._projectId = props.projectId;
    this._provider = props.provider;
    this._handle = props.handle;
    this._credentials = { ...props.credentials };
    this._status = props.status ?? CONNECTION_STATUS.PENDING;
    this._lastHealthCheck = props.lastHealthCheck;
    this._errorCount = props.errorCount ?? 0;
    this._lastError = props.lastError;

    if (props.updatedAt) {
      this._updatedAt = props.updatedAt;
    }
  }

  /**
   * Factory method to create a new Channel
   */
  static create(
    input: CreateChannelInput
  ): Result<Channel, InvalidValueError | InvariantViolationError> {
    // Validate handle
    if (!input.handle || input.handle.trim().length === 0) {
      return err(new InvalidValueError("handle", input.handle, "Handle cannot be empty"));
    }

    // Validate credentials
    if (!input.credentials.accessToken || input.credentials.accessToken.trim().length === 0) {
      return err(new InvalidValueError("accessToken", "[hidden]", "Access token is required"));
    }

    // Get or create provider
    let provider: Provider;
    if (input.provider instanceof Provider) {
      provider = input.provider;
    } else {
      const providerResult = Provider.fromString(input.provider);
      if (!providerResult.ok) {
        return err(providerResult.error);
      }
      provider = providerResult.value;
    }

    return ok(
      new Channel(ChannelId.generate(), {
        projectId: input.projectId,
        provider,
        handle: input.handle.trim(),
        credentials: input.credentials,
        status: CONNECTION_STATUS.CONNECTED,
      })
    );
  }

  /**
   * Reconstruct a Channel from persistence
   */
  static reconstitute(
    id: ChannelId,
    props: {
      projectId: ProjectId;
      provider: Provider;
      handle: string;
      credentials: ChannelCredentials;
      status: ConnectionStatusValue;
      lastHealthCheck?: Date;
      errorCount: number;
      lastError?: string;
      createdAt: Date;
      updatedAt: Date;
    }
  ): Channel {
    return new Channel(id, props);
  }

  // Getters

  get entityType(): string {
    return "Channel";
  }

  get projectId(): ProjectId {
    return this._projectId;
  }

  get provider(): Provider {
    return this._provider;
  }

  get handle(): string {
    return this._handle;
  }

  get credentials(): Readonly<ChannelCredentials> {
    return { ...this._credentials };
  }

  get status(): ConnectionStatusValue {
    return this._status;
  }

  get lastHealthCheck(): Date | undefined {
    return this._lastHealthCheck ? new Date(this._lastHealthCheck.getTime()) : undefined;
  }

  get errorCount(): number {
    return this._errorCount;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  // Status predicates

  get isConnected(): boolean {
    return this._status === CONNECTION_STATUS.CONNECTED;
  }

  get isDisconnected(): boolean {
    return this._status === CONNECTION_STATUS.DISCONNECTED;
  }

  get hasError(): boolean {
    return this._status === CONNECTION_STATUS.ERROR;
  }

  get isExpired(): boolean {
    return this._status === CONNECTION_STATUS.EXPIRED;
  }

  get isPending(): boolean {
    return this._status === CONNECTION_STATUS.PENDING;
  }

  /**
   * Check if credentials are expired
   */
  get areCredentialsExpired(): boolean {
    if (!this._credentials.expiresAt) {
      return false;
    }
    return this._credentials.expiresAt.getTime() < Date.now();
  }

  /**
   * Check if channel is healthy (connected and no recent errors)
   */
  get isHealthy(): boolean {
    return this.isConnected && this._errorCount === 0 && !this.areCredentialsExpired;
  }

  // Domain behavior

  /**
   * Update handle
   */
  updateHandle(newHandle: string): Result<void, InvalidValueError> {
    if (!newHandle || newHandle.trim().length === 0) {
      return err(new InvalidValueError("handle", newHandle, "Handle cannot be empty"));
    }

    this._handle = newHandle.trim();
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Update credentials (e.g., after token refresh)
   */
  updateCredentials(credentials: ChannelCredentials): Result<void, InvalidValueError> {
    if (!credentials.accessToken || credentials.accessToken.trim().length === 0) {
      return err(new InvalidValueError("accessToken", "[hidden]", "Access token is required"));
    }

    this._credentials = { ...credentials };
    this._status = CONNECTION_STATUS.CONNECTED;
    this._errorCount = 0;
    this._lastError = undefined;
    this.markUpdated();

    return ok(undefined);
  }

  /**
   * Mark channel as connected after successful health check
   */
  markAsConnected(): void {
    this._status = CONNECTION_STATUS.CONNECTED;
    this._lastHealthCheck = new Date();
    this._errorCount = 0;
    this._lastError = undefined;
    this.markUpdated();
  }

  /**
   * Mark channel as disconnected
   */
  markAsDisconnected(): void {
    this._status = CONNECTION_STATUS.DISCONNECTED;
    this.markUpdated();
  }

  /**
   * Mark channel as having an error
   */
  markAsError(errorMessage: string): void {
    this._status = CONNECTION_STATUS.ERROR;
    this._errorCount += 1;
    this._lastError = errorMessage;
    this.markUpdated();
  }

  /**
   * Mark credentials as expired
   */
  markAsExpired(): void {
    this._status = CONNECTION_STATUS.EXPIRED;
    this.markUpdated();
  }

  /**
   * Record a successful health check
   */
  recordHealthCheck(): void {
    this._lastHealthCheck = new Date();
    if (this._status === CONNECTION_STATUS.ERROR || this._status === CONNECTION_STATUS.PENDING) {
      this._status = CONNECTION_STATUS.CONNECTED;
      this._errorCount = 0;
      this._lastError = undefined;
    }
    this.markUpdated();
  }

  /**
   * Record a failed operation (increments error count)
   */
  recordError(errorMessage: string): void {
    this._errorCount += 1;
    this._lastError = errorMessage;

    // If too many errors, mark as error status
    if (this._errorCount >= 3) {
      this._status = CONNECTION_STATUS.ERROR;
    }
    this.markUpdated();
  }

  /**
   * Reset error count (e.g., after successful operation)
   */
  resetErrors(): void {
    this._errorCount = 0;
    this._lastError = undefined;
    if (this._status === CONNECTION_STATUS.ERROR) {
      this._status = CONNECTION_STATUS.CONNECTED;
    }
    this.markUpdated();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      projectId: this._projectId.toString(),
      provider: this._provider.type,
      handle: this._handle,
      status: this._status,
      errorCount: this._errorCount,
      ...(this._lastHealthCheck && { lastHealthCheck: this._lastHealthCheck.toISOString() }),
      ...(this._lastError && { lastError: this._lastError }),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      // Note: credentials are intentionally excluded for security
    };
  }
}
