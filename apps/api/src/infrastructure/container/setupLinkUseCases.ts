/**
 * @file setupLinkUseCases.ts
 * @description Registers all tracked link use cases in the DI container.
 *              Extracted from setupUseCases.ts for domain-based modularization.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { TrackedLinkRepository } from "../../domain/repositories/TrackedLinkRepository.js";
import type { GA4TrackingPort } from "../../domain/repositories/GA4TrackingPort.js";
import {
  CreateTrackedLinkUseCase,
  GetTrackedLinkUseCase,
  RedirectAndTrackClickUseCase,
  GetLinkStatsUseCase,
  DeleteTrackedLinkUseCase,
} from "../../application/links/index.js";

/**
 * Register all tracked link use cases in the container
 */
export function setupLinkUseCases(container: Container): void {
  // Register Tracked Link Use Cases (P1-DI-7)
  container.register<CreateTrackedLinkUseCase>(
    TOKENS.CreateTrackedLinkUseCase,
    () =>
      new CreateTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<GetTrackedLinkUseCase>(
    TOKENS.GetTrackedLinkUseCase,
    () =>
      new GetTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<GetLinkStatsUseCase>(
    TOKENS.GetLinkStatsUseCase,
    () =>
      new GetLinkStatsUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<DeleteTrackedLinkUseCase>(
    TOKENS.DeleteTrackedLinkUseCase,
    () =>
      new DeleteTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<RedirectAndTrackClickUseCase>(
    TOKENS.RedirectAndTrackClickUseCase,
    () =>
      new RedirectAndTrackClickUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository),
        container.resolve<GA4TrackingPort>(TOKENS.GA4TrackingPort)
      ),
    true
  );
}
