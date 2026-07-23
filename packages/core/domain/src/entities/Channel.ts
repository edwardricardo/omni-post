/**
 * @file Channel.ts
 * @description Domain entity representing a social media channel connected to a project — manages OAuth credentials, connection status, and provider metadata.
 * @layer domain
 */

import { type Result, ok, err } from "@shared/types";
import { Entity, type EntityProps } from "./Entity.js";
import { ChannelId, ProjectId, AccountId } from "../value-objects/EntityId.js";
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
  // Tenant scope. Denormalized from the owning Project.accountId so the
  // Prisma tenant guard (and RLS) can filter Channel rows without a join.
  accountId: AccountId;
  provider: Provider;
  handle: string;
  credentials: ChannelCredentials;
  isPrimary?: boolean;
  status?: ConnectionStatusValue;
  lastHealthCheck?: Date;
  errorCount?: number;
  lastError?: string;
  needsReauth?: boolean;
  authFailedAt?: Date;
  authFailureReason?: string;
  // Display + lifecycle fields. accountName/profileImage are populated at
  // OAuth callback time; connectedAt is the most recent successful grant;
  // expiredAt is the latest natural-expiry timestamp — NEVER cleared on
  // reconnect, survives as audit trail; lastUsedAt tracks the most recent
  // publish.
  accountName?: string;
  profileImage?: string;
  connectedAt?: Date;
  expiredAt?: Date;
  lastUsedAt?: Date;
  // Provider-side account identifier (Facebook page_id, Instagram account_id,
  // X user_id, etc.). Used to resolve "is this OAuth grant for an existing
  // Channel or a new one?" at callback time.
  providerAccountId?: string;
}

/**
 * Channel creation input
 */
export interface CreateChannelInput {
  projectId: ProjectId;
  // Tenant scope, denormalized from the owning Project. Callers resolve it
  // from the already-ownership-verified project (OAuth callback / connect).
  accountId: AccountId;
  provider: ProviderType | Provider;
  handle: string;
  credentials: ChannelCredentials;
  // Display + identity fields populated by OAuth callback when creating a
  // fresh Channel from a provider grant.
  accountName?: string;
  profileImage?: string;
  connectedAt?: Date;
  providerAccountId?: string;
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
  private readonly _accountId: AccountId;
  private readonly _provider: Provider;
  private _handle: string;
  private _credentials: ChannelCredentials;
  private _isPrimary: boolean;
  private _status: ConnectionStatusValue;
  private _lastHealthCheck: Date | undefined;
  private _errorCount: number;
  private _lastError: string | undefined;
  private _needsReauth: boolean;
  private _authFailedAt: Date | undefined;
  private _authFailureReason: string | undefined;
  private _accountName: string | undefined;
  private _profileImage: string | undefined;
  private _connectedAt: Date | undefined;
  private _expiredAt: Date | undefined;
  private _lastUsedAt: Date | undefined;
  private _providerAccountId: string | undefined;
  private constructor(id: ChannelId, props: ChannelProps) {
    super(id, props.createdAt);
    this._projectId = props.projectId;
    this._accountId = props.accountId;
    this._provider = props.provider;
    this._handle = props.handle;
    this._credentials = { ...props.credentials };
    this._isPrimary = props.isPrimary ?? false;
    this._status = props.status ?? CONNECTION_STATUS.PENDING;
    this._lastHealthCheck = props.lastHealthCheck;
    this._errorCount = props.errorCount ?? 0;
    this._lastError = props.lastError;
    this._needsReauth = props.needsReauth ?? false;
    this._authFailedAt = props.authFailedAt;
    this._authFailureReason = props.authFailureReason;
    this._accountName = props.accountName;
    this._profileImage = props.profileImage;
    this._connectedAt = props.connectedAt;
    this._expiredAt = props.expiredAt;
    this._lastUsedAt = props.lastUsedAt;
    this._providerAccountId = props.providerAccountId;

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
        accountId: input.accountId,
        provider,
        handle: input.handle.trim(),
        credentials: input.credentials,
        status: CONNECTION_STATUS.CONNECTED,
        ...(input.accountName !== undefined && { accountName: input.accountName }),
        ...(input.profileImage !== undefined && { profileImage: input.profileImage }),
        ...(input.providerAccountId !== undefined && {
          providerAccountId: input.providerAccountId,
        }),
        connectedAt: input.connectedAt ?? new Date(),
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
      accountId: AccountId;
      provider: Provider;
      handle: string;
      credentials: ChannelCredentials;
      isPrimary?: boolean;
      status: ConnectionStatusValue;
      lastHealthCheck?: Date;
      errorCount: number;
      lastError?: string;
      needsReauth?: boolean;
      authFailedAt?: Date;
      authFailureReason?: string;
      accountName?: string;
      profileImage?: string;
      connectedAt?: Date;
      expiredAt?: Date;
      lastUsedAt?: Date;
      providerAccountId?: string;
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

  /**
   * Tenant scope for this channel, denormalized from the owning
   * `Project.accountId`. Used by the persistence adapter to satisfy the
   * Prisma tenant guard's required `accountId` on create.
   */
  get accountId(): AccountId {
    return this._accountId;
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

  get isPrimary(): boolean {
    return this._isPrimary;
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

  get needsReauth(): boolean {
    return this._needsReauth;
  }

  get authFailedAt(): Date | undefined {
    return this._authFailedAt ? new Date(this._authFailedAt.getTime()) : undefined;
  }

  get authFailureReason(): string | undefined {
    return this._authFailureReason;
  }

  get accountName(): string | undefined {
    return this._accountName;
  }

  get profileImage(): string | undefined {
    return this._profileImage;
  }

  get connectedAt(): Date | undefined {
    return this._connectedAt ? new Date(this._connectedAt.getTime()) : undefined;
  }

  /**
   * Most recent natural expiry timestamp. NEVER cleared on reconnect —
   * survives as historical audit trail. To check if a channel is currently
   * expired (i.e., needs reauth), use `isExpired` (status-based) instead.
   */
  get expiredAt(): Date | undefined {
    return this._expiredAt ? new Date(this._expiredAt.getTime()) : undefined;
  }

  get lastUsedAt(): Date | undefined {
    return this._lastUsedAt ? new Date(this._lastUsedAt.getTime()) : undefined;
  }

  get providerAccountId(): string | undefined {
    return this._providerAccountId;
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
   * Mark credentials as expired. Stamps `expiredAt` with the current
   * timestamp; subsequent re-expiries overwrite it (most-recent-expiry
   * semantics). The timestamp is NEVER cleared on reconnect — it survives
   * as audit trail.
   */
  markAsExpired(): void {
    this._status = CONNECTION_STATUS.EXPIRED;
    this._expiredAt = new Date();
    this.markUpdated();
  }

  /**
   * Record a successful re-OAuth grant. Transitions status back to
   * CONNECTED, stamps `connectedAt`, clears the reauth-required flag, and
   * resets error counters. Does NOT clear `expiredAt` — that's audit
   * history. Idempotent in the sense that re-connecting an already-connected
   * channel just refreshes timestamps.
   */
  recordReconnection(): void {
    this._status = CONNECTION_STATUS.CONNECTED;
    this._connectedAt = new Date();
    this._needsReauth = false;
    this._authFailedAt = undefined;
    this._authFailureReason = undefined;
    this._errorCount = 0;
    this._lastError = undefined;
    this.markUpdated();
  }

  /**
   * Update the publish-tracking timestamp. Called by the publishing flow
   * after a successful provider publish; powers the `lastUsedAt` UX field
   * and the listing-page denormalisation that avoids per-row MAX subqueries
   * over PublishLog.
   */
  recordPublish(at: Date = new Date()): void {
    this._lastUsedAt = new Date(at.getTime());
    this.markUpdated();
  }

  /**
   * Update display fields populated from the provider OAuth callback.
   * Both fields optional — only the ones supplied are written. No-op if
   * the input has neither field set.
   */
  updateProfile(input: { accountName?: string; profileImage?: string }): void {
    let touched = false;
    if (input.accountName !== undefined) {
      this._accountName = input.accountName;
      touched = true;
    }
    if (input.profileImage !== undefined) {
      this._profileImage = input.profileImage;
      touched = true;
    }
    if (touched) {
      this.markUpdated();
    }
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

  /**
   * Mark this channel as the primary channel for its (project, provider) pair.
   * Idempotent — calling on an already-primary channel is a no-op (no markUpdated).
   *
   * Uniqueness across the (project, provider, isPrimary=true) tuple is enforced
   * at the persistence layer via a partial unique index, so any caller that
   * promotes a channel must unmark the previous primary inside the same
   * transaction or the constraint will fail mid-flight.
   */
  markAsPrimary(): void {
    if (this._isPrimary) {
      return;
    }
    this._isPrimary = true;
    this.markUpdated();
  }

  /**
   * Remove the primary flag from this channel. Idempotent.
   */
  unmarkAsPrimary(): void {
    if (!this._isPrimary) {
      return;
    }
    this._isPrimary = false;
    this.markUpdated();
  }

  /**
   * Flag the channel as requiring user re-authorization. Sets the failure
   * timestamp + reason so the client app can surface a contextual banner.
   * Workers call this on AUTH errors from the provider; admins call it
   * proactively when rotating provider OAuth client secrets.
   * Always re-stamps `authFailedAt` so consecutive triggers are visible.
   */
  markForReauth(reason: string): void {
    this._needsReauth = true;
    this._authFailedAt = new Date();
    this._authFailureReason = reason;
    this.markUpdated();
  }

  /**
   * Clear the reauth flag once the user completes the re-grant flow.
   * Idempotent.
   */
  clearReauthFlag(): void {
    if (!this._needsReauth) {
      return;
    }
    this._needsReauth = false;
    this._authFailedAt = undefined;
    this._authFailureReason = undefined;
    this.markUpdated();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this._id.toString(),
      projectId: this._projectId.toString(),
      provider: this._provider.type,
      handle: this._handle,
      isPrimary: this._isPrimary,
      status: this._status,
      errorCount: this._errorCount,
      ...(this._lastHealthCheck && { lastHealthCheck: this._lastHealthCheck.toISOString() }),
      ...(this._lastError && { lastError: this._lastError }),
      ...(this._accountName !== undefined && { accountName: this._accountName }),
      ...(this._profileImage !== undefined && { profileImage: this._profileImage }),
      ...(this._connectedAt && { connectedAt: this._connectedAt.toISOString() }),
      ...(this._expiredAt && { expiredAt: this._expiredAt.toISOString() }),
      ...(this._lastUsedAt && { lastUsedAt: this._lastUsedAt.toISOString() }),
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      // Note: credentials are intentionally excluded for security
    };
  }
}
