/**
 * @file setupReferralUseCases.ts
 * @description DI registrations for referral use cases: convert, grant reward,
 *              track signup, and get-or-create referral code.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";

import { PrismaConvertReferralRepository } from "../repositories/PrismaConvertReferralRepository.js";
import { PrismaGrantRewardRepository } from "../repositories/PrismaGrantRewardRepository.js";
import { PrismaReferralRepository } from "../repositories/PrismaReferralRepository.js";
import { PrismaReferralCodeRepository } from "../repositories/PrismaReferralCodeRepository.js";

import type { ConvertReferralRepository } from "../../application/referral/ConvertReferralUseCase.js";
import { ConvertReferralUseCase } from "../../application/referral/ConvertReferralUseCase.js";
import type { GrantRewardRepository } from "../../application/referral/GrantReferralRewardUseCase.js";
import { GrantReferralRewardUseCase } from "../../application/referral/GrantReferralRewardUseCase.js";
import type { ReferralRepository } from "../../application/referral/TrackReferralSignupUseCase.js";
import { TrackReferralSignupUseCase } from "../../application/referral/TrackReferralSignupUseCase.js";
import type { ReferralCodeRepository } from "../../application/referral/GetOrCreateReferralCodeUseCase.js";
import { GetOrCreateReferralCodeUseCase } from "../../application/referral/GetOrCreateReferralCodeUseCase.js";

/**
 * @method setupReferralUseCases
 * @description Registers referral repositories and use cases in the DI container.
 */
export function setupReferralUseCases(container: Container): void {
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
        container.tryResolve<EmailPort>(TOKENS.EmailPort),
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
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
}
