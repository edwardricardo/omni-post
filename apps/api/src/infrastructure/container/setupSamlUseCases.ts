/**
 * @file setupSamlUseCases.ts
 * @description DI registrations for SAML 2.0 and OIDC SSO features.
 *              Registers repository adapters and all use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaSamlConfigurationRepository } from "../repositories/PrismaSamlConfigurationRepository.js";
import { PrismaOidcConfigurationRepository } from "../repositories/PrismaOidcConfigurationRepository.js";
import type { EncryptionService } from "../../security/EncryptionService.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";
import { ConfigureSamlUseCase } from "@core/auth/ConfigureSamlUseCase.js";
import { EnableSsoUseCase } from "@core/auth/EnableSsoUseCase.js";
import { DisableSsoUseCase } from "@core/auth/DisableSsoUseCase.js";
import { GetSamlConfigurationQuery } from "@core/auth/GetSamlConfigurationQuery.js";
import { ConfigureOidcUseCase } from "@core/auth/ConfigureOidcUseCase.js";
import { EnableOidcSsoUseCase } from "@core/auth/EnableOidcSsoUseCase.js";
import { DisableOidcSsoUseCase } from "@core/auth/DisableOidcSsoUseCase.js";
import { GetOidcConfigurationQuery } from "@core/auth/GetOidcConfigurationQuery.js";
import { ReplaceOidcClientSecretUseCase } from "@core/auth/ReplaceOidcClientSecretUseCase.js";
import { OpenidClientHandshakeProbe } from "../auth/OpenidClientHandshakeProbe.js";

/**
 * @function setupSamlUseCases
 * @description Registers SAML + OIDC repositories and use cases into the DI container.
 * @param container - The application DI container
 */
export function setupSamlUseCases(container: Container): void {
  const resolveUoW = (): UnitOfWork => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);
  const resolveAccountQueryRepo = (): AccountQueryRepositoryPort =>
    container.resolve<AccountQueryRepositoryPort>(TOKENS.AccountQueryRepository);

  // ── SAML ──────────────────────────────────────────────────────────────────

  const samlRepo = new PrismaSamlConfigurationRepository(prisma);
  container.registerInstance(TOKENS.SamlConfigurationRepository, samlRepo);

  container.registerInstance(
    TOKENS.ConfigureSamlUseCase,
    new ConfigureSamlUseCase(samlRepo, resolveUoW())
  );

  container.register(
    TOKENS.EnableSsoUseCase,
    () => new EnableSsoUseCase(samlRepo, resolveAccountQueryRepo()),
    true
  );

  container.register(
    TOKENS.DisableSsoUseCase,
    () => new DisableSsoUseCase(resolveAccountQueryRepo()),
    true
  );

  container.registerInstance(
    TOKENS.GetSamlConfigurationQuery,
    new GetSamlConfigurationQuery(samlRepo)
  );

  // ── OIDC ──────────────────────────────────────────────────────────────────

  // Lazy registration so EncryptionService doesn't have to be wired before
  // this setup function runs — keeps tests and bootstrap order flexible.
  container.register(
    TOKENS.OidcConfigurationRepository,
    () =>
      new PrismaOidcConfigurationRepository(
        prisma,
        container.resolve<EncryptionService>(TOKENS.EncryptionService)
      ),
    true
  );
  const resolveOidcRepo = () =>
    container.resolve<PrismaOidcConfigurationRepository>(TOKENS.OidcConfigurationRepository);

  container.register(
    TOKENS.ConfigureOidcUseCase,
    () => new ConfigureOidcUseCase(resolveOidcRepo(), resolveUoW()),
    true
  );

  container.register(
    TOKENS.EnableOidcSsoUseCase,
    () => new EnableOidcSsoUseCase(resolveOidcRepo(), resolveAccountQueryRepo()),
    true
  );

  container.register(
    TOKENS.DisableOidcSsoUseCase,
    () => new DisableOidcSsoUseCase(resolveAccountQueryRepo()),
    true
  );

  container.register(
    TOKENS.ReplaceOidcClientSecretUseCase,
    () =>
      new ReplaceOidcClientSecretUseCase(
        resolveOidcRepo(),
        new OpenidClientHandshakeProbe(),
        resolveUoW()
      ),
    true
  );

  container.register(
    TOKENS.GetOidcConfigurationQuery,
    () => new GetOidcConfigurationQuery(resolveOidcRepo()),
    true
  );
}
