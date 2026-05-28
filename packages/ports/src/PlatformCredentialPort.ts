/**
 * @file PlatformCredentialPort.ts
 * @description Application-layer port for accessing platform credentials
 *   (provider API keys/tokens stored encrypted) from outside the `security`
 *   bounded context. Adapter lives in `@core/security` and is wired in the
 *   composition root.
 *
 *   Resolves §5.1 cross-context violation `settings -> security`
 *   (SettingsService type-imported PlatformCredentialService from
 *   `@core/application/security`). The `settings` context used to depend on
 *   a security implementation type; now it depends on this port and the
 *   composition root injects the security adapter.
 *
 *   Workstream: §5.1 Normalization Roadmap — fullscope split.
 *
 * @layer domain
 */

export interface PlatformCredentialDescriptor {
  readonly id: string;
  readonly accountId: string;
  readonly provider: string;
  readonly label: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export interface PlatformCredentialPort {
  list(accountId: string): Promise<ReadonlyArray<PlatformCredentialDescriptor>>;
  getById(accountId: string, credentialId: string): Promise<PlatformCredentialDescriptor | null>;
}
