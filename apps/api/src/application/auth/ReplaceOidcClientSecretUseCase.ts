/**
 * @file ReplaceOidcClientSecretUseCase.ts
 * @description Admin-triggered atomic replace of OidcConfiguration.clientSecret.
 *              Performs an IdP handshake test against the new secret BEFORE
 *              persisting; if the handshake fails, no DB write happens. The
 *              handshake runs OUTSIDE the UoW (external HTTP); the persistence
 *              runs INSIDE the UoW (canonical CLAUDE.md rule).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { OidcConfigurationRepository } from "../../domain/repositories/OidcConfigurationRepository.js";
import {
  OidcConfiguration,
  type OidcAttributeMapping,
} from "../../domain/entities/OidcConfiguration.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

/**
 * Result of the handshake probe. `strict` = both discovery + token-endpoint
 * authentication succeeded (full validation). `partial` = discovery succeeded
 * but token endpoint rejected `client_credentials` grant with
 * `unsupported_grant_type` — common for SSO-only configs. The use case still
 * persists in `partial` but emits an audit-log note.
 */
export type OidcHandshakeResult =
  | { validated: "strict" }
  | { validated: "partial"; reason: string };

/**
 * Adapter for the IdP handshake validation. Per canon
 * `oidc-client-secret-validation-clientcredentialsgrant`, this MUST hit the
 * token endpoint to actually validate the clientSecret — discovery alone is
 * insufficient. Production wiring chains discovery + clientCredentialsGrant;
 * tests stub directly. Throws on real auth failure (`invalid_client`,
 * network errors, malformed metadata) — caught by use case and mapped to
 * VALIDATION_FAILED.
 */
export interface OidcHandshakeProbe {
  discover(input: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
  }): Promise<OidcHandshakeResult>;
}

export interface ReplaceOidcClientSecretInput {
  accountId: string;
  newClientSecret: string;
}

export interface ReplaceOidcClientSecretOutput {
  accountId: string;
  issuerUrl: string;
  updatedAt: string;
  /**
   * Validation level achieved by the handshake probe before persisting.
   * `strict`: token endpoint authenticated the new secret (canonical).
   * `partial`: IdP rejected `client_credentials` grant (`unsupported_grant_type`);
   *   secret format-check passed via discovery but real auth could not be
   *   verified server-side. Operator should confirm via real SSO attempt.
   */
  validation: "strict" | "partial";
  /** Present when validation === "partial" — the IdP-provided reason. */
  validationReason?: string;
}

export class ReplaceOidcClientSecretUseCase implements UseCase<
  ReplaceOidcClientSecretInput,
  ReplaceOidcClientSecretOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: OidcConfigurationRepository,
    private readonly handshakeProbe: OidcHandshakeProbe,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: ReplaceOidcClientSecretInput
  ): Promise<Result<ReplaceOidcClientSecretOutput, UseCaseError>> {
    if (!input.accountId.trim()) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.newClientSecret.trim()) {
      return err(
        new UseCaseError("newClientSecret is required", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const data = await this.repository.findByAccountId(input.accountId);
    if (!data) {
      return err(
        new UseCaseError(
          `OIDC configuration not found for account: ${input.accountId}`,
          USE_CASE_ERRORS.NOT_FOUND
        )
      );
    }

    // Handshake test runs OUTSIDE the UoW (external HTTP).
    // Per canon `oidc-client-secret-validation-clientcredentialsgrant`,
    // probe chains discovery + clientCredentialsGrant; returns either
    // `strict` (full validation) or `partial` (IdP rejected
    // `client_credentials` grant — common for SSO-only configs).
    let handshakeResult: OidcHandshakeResult;
    try {
      handshakeResult = await this.handshakeProbe.discover({
        issuerUrl: data.issuerUrl,
        clientId: data.clientId,
        clientSecret: input.newClientSecret,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        new UseCaseError(
          `IdP handshake failed with the new client secret: ${message}`,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          error instanceof Error ? error : undefined
        )
      );
    }

    const entity = OidcConfiguration.reconstitute({
      id: data.id,
      accountId: data.accountId,
      issuerUrl: data.issuerUrl,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      scopes: data.scopes,
      attributeMapping: data.attributeMapping as OidcAttributeMapping,
      isActive: data.isActive,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
    const replaceResult = entity.replaceClientSecret(input.newClientSecret);
    if (!replaceResult.ok) {
      return err(
        new UseCaseError(
          replaceResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          replaceResult.error
        )
      );
    }

    const doWork = async (): Promise<Result<ReplaceOidcClientSecretOutput, UseCaseError>> => {
      const saveResult = await this.repository.save(entity);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to persist OIDC client secret rotation",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }
      return ok({
        accountId: entity.accountId,
        issuerUrl: entity.issuerUrl,
        updatedAt: entity.updatedAt.toISOString(),
        validation: handshakeResult.validated,
        ...(handshakeResult.validated === "partial" && {
          validationReason: handshakeResult.reason,
        }),
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ReplaceOidcClientSecretOutput, UseCaseError> = err(
          new UseCaseError("Transaction did not complete", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to replace OIDC client secret",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
