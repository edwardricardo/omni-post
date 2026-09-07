/**
 * @file setupReferralUseCases.ts
 * @description DI registrations for referral use cases: convert, grant reward,
 *              track signup, and get-or-create referral code.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { PrismaClient } from "@infra/prisma";
import { env } from "../../config/env.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { ReferralRewardMailer } from "@core/domain/repositories/ReferralRewardMailer.js";

import { PrismaConvertReferralRepository } from "../repositories/PrismaConvertReferralRepository.js";
import { PrismaGrantRewardRepository } from "../repositories/PrismaGrantRewardRepository.js";
import { PrismaReferralRepository } from "../repositories/PrismaReferralRepository.js";
import { PrismaReferralCodeRepository } from "../repositories/PrismaReferralCodeRepository.js";

import type { ConvertReferralRepository } from "@core/referral/ConvertReferralUseCase.js";
import { ConvertReferralUseCase } from "@core/referral/ConvertReferralUseCase.js";
import type { GrantRewardRepository } from "@core/referral/GrantReferralRewardUseCase.js";
import { GrantReferralRewardUseCase } from "@core/referral/GrantReferralRewardUseCase.js";
import type { ReferralRepository } from "@core/referral/TrackReferralSignupUseCase.js";
import { TrackReferralSignupUseCase } from "@core/referral/TrackReferralSignupUseCase.js";
import type { ReferralCodeRepository } from "@core/referral/GetOrCreateReferralCodeUseCase.js";
import { GetOrCreateReferralCodeUseCase } from "@core/referral/GetOrCreateReferralCodeUseCase.js";

/**
 * @method setupReferralUseCases
 * @description Registers referral repositories and use cases in the DI container.
 */
export function setupReferralUseCases(container: Container): void {
  // The container's client, never the `@infra/prisma` singleton — `setup.ts` applies the tenant
  // guard and the request-scoped GUC binding there. `referralCode`, `conversion` and
  // `accountSubscription` are guard-enrolled and RLS-covered.
  //
  // Scope declaration for the signup-time lookup: `PrismaReferralRepository.findCodeByCode`
  // resolves a code that belongs to the REFERRER's account from a request that has no tenant
  // yet, so it is tenant DISCOVERY, not a tenant-scoped read — the `getChannelOwnerAccountId`
  // shape, and it is already narrow by construction (`select: { id: true }`). Its declaration
  // belongs at the signup boundary that calls it, and NO bypass is written here because no
  // route consumes these use cases today (measured: nothing outside this container module
  // resolves any referral token). Until one is wired the guard makes the gap loud — an unbound
  // signup read throws instead of silently resolving no code — which is the outcome to keep.
  const prisma = container.resolve<PrismaClient>(TOKENS.PrismaClient);

  // Repositories
  container.registerInstance<ConvertReferralRepository>(
    TOKENS.ConvertReferralRepository,
    new PrismaConvertReferralRepository(prisma)
  );
  container.registerInstance<GrantRewardRepository>(
    TOKENS.GrantRewardRepository,
    new PrismaGrantRewardRepository(prisma)
  );
  container.registerInstance<ReferralRepository>(
    TOKENS.ReferralRepository,
    new PrismaReferralRepository(prisma)
  );
  container.registerInstance<ReferralCodeRepository>(
    TOKENS.ReferralCodeRepository,
    new PrismaReferralCodeRepository(prisma)
  );

  // GrantReferralRewardUseCase (registered first — used by ConvertReferralUseCase)
  container.register<GrantReferralRewardUseCase>(
    TOKENS.GrantReferralRewardUseCase,
    () =>
      new GrantReferralRewardUseCase(
        container.resolve<GrantRewardRepository>(TOKENS.GrantRewardRepository),
        container.tryResolve<ReferralRewardMailer>(TOKENS.ReferralRewardMailer),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // ConvertReferralUseCase (delegates to GrantReferralRewardUseCase)
  container.register<ConvertReferralUseCase>(
    TOKENS.ConvertReferralUseCase,
    () =>
      new ConvertReferralUseCase(
        container.resolve<ConvertReferralRepository>(TOKENS.ConvertReferralRepository),
        container.resolve<GrantReferralRewardUseCase>(TOKENS.GrantReferralRewardUseCase),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // TrackReferralSignupUseCase
  container.register<TrackReferralSignupUseCase>(
    TOKENS.TrackReferralSignupUseCase,
    () =>
      new TrackReferralSignupUseCase(
        container.resolve<ReferralRepository>(TOKENS.ReferralRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // GetOrCreateReferralCodeUseCase
  container.register<GetOrCreateReferralCodeUseCase>(
    TOKENS.GetOrCreateReferralCodeUseCase,
    () =>
      new GetOrCreateReferralCodeUseCase(
        container.resolve<ReferralCodeRepository>(TOKENS.ReferralCodeRepository),
        env.CLIENT_URL ?? "http://localhost:3002",
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
