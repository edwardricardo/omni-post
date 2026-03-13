/**
 * @file setupBrandVoiceUseCases.ts
 * @description DI registrations for Brand Voice feature (Task 11.7).
 *              Registers repository adapter and use cases as singletons.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import { PrismaBrandVoiceRepository } from "../repositories/PrismaBrandVoiceRepository.js";
import { GetBrandVoiceQuery } from "../../application/brand-voice/GetBrandVoiceQuery.js";
import { UpsertBrandVoiceUseCase } from "../../application/brand-voice/UpsertBrandVoiceUseCase.js";
import { DeleteBrandVoiceUseCase } from "../../application/brand-voice/DeleteBrandVoiceUseCase.js";

export function setupBrandVoiceUseCases(container: Container): void {
  const repo = new PrismaBrandVoiceRepository(prisma);
  container.registerInstance(TOKENS.BrandVoiceRepository, repo);
  container.registerInstance(TOKENS.GetBrandVoiceQuery, new GetBrandVoiceQuery(repo));
  container.registerInstance(TOKENS.UpsertBrandVoiceUseCase, new UpsertBrandVoiceUseCase(repo));
  container.registerInstance(TOKENS.DeleteBrandVoiceUseCase, new DeleteBrandVoiceUseCase(repo));
}
