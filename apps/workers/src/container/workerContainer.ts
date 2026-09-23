/**
 * @file workerContainer.ts
 * @description Composition root for the workers deployable. This is the ONLY
 *   module under apps/workers/src that imports the @infra/prisma singleton;
 *   every worker factory receives PrismaClient by constructor injection from
 *   here (Mark Seemann — "composition root per executable"). The boot-time DB
 *   auth check is re-exported so each worker entry verifies the connection
 *   without reaching for the global itself.
 *
 *   The aggregate path is wired over the SAME shared use cases the API resolves
 *   (`@core/posts`), never a worker-local reimplementation: one composition root per
 *   executable, one application core between them.
 * @layer infrastructure
 */

import { prisma, verifyDatabaseAuth } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { tenantGuardWithGucBindingExtension } from "@infra/prisma/extensions/tenantGucBinding.js";
import { PrismaOutboxWriter, PrismaPostRepository, PrismaUnitOfWork } from "@adapters/db-prisma";
import { OpenPublicationEpisodeUseCase, RecordChannelPublicationAttemptUseCase } from "@core/posts";
import { workerTenantProvider } from "../security/workerTenantContext.js";

/** The shared PrismaClient for the workers process, resolved once here. */
export const workerPrisma: PrismaClient = prisma;

/** The post aggregate path for the workers process, over one client that guards it. */
export interface WorkerPostWiring {
  readonly guardedPrisma: PrismaClient;
  readonly postRepository: PrismaPostRepository;
  readonly unitOfWork: PrismaUnitOfWork;
  /** Opens the publication episode a redrive of this post's channels belongs to. */
  readonly openPublicationEpisode: OpenPublicationEpisodeUseCase;
  /** Records what ONE channel's attempt achieved, and what the aggregate derives from it. */
  readonly recordChannelPublicationAttempt: RecordChannelPublicationAttemptUseCase;
}

let wiring: WorkerPostWiring | undefined;

/**
 * @function workerPostWiring
 * @description Builds the post aggregate path on first call and memoises it.
 *
 *   A function rather than module-level constants because the singleton is a lazy Proxy
 *   that constructs the real client on ANY property access — and `$extends` is a property
 *   access. Built at module scope, the graph makes every importer of this live root open a
 *   database connection just by importing it, `bootstrap.ts` first, which reaches the root
 *   before `config/env.ts` has loaded `.env`: the process then died on a raw missing
 *   `DATABASE_URL` instead of its own validation naming what was unset.
 * @returns The guarded client, the post persistence over it, and the two shared use cases.
 */
export function workerPostWiring(): WorkerPostWiring {
  if (wiring) {
    return wiring;
  }
  // The tenant guard (layer 1) and the per-operation RLS GUC binding (layer 2) in ONE
  // `$extends`, over ONE provider object — so the injected `where.accountId` and the policy
  // GUC cannot drift apart. The client is passed in because that is what the binding opens
  // its batch transaction on. The raw `workerPrisma` stays for rendering, credentials and
  // threads, which resolve a tenant rather than run inside one.
  const guardedPrisma = workerPrisma.$extends(
    tenantGuardWithGucBindingExtension(workerPrisma, workerTenantProvider)
  ) as unknown as PrismaClient;
  const postRepository = new PrismaPostRepository(
    guardedPrisma,
    new PrismaOutboxWriter(),
    workerTenantProvider
  );
  const unitOfWork = new PrismaUnitOfWork(guardedPrisma, workerTenantProvider);
  wiring = {
    guardedPrisma,
    postRepository,
    unitOfWork,
    openPublicationEpisode: new OpenPublicationEpisodeUseCase(postRepository, unitOfWork),
    recordChannelPublicationAttempt: new RecordChannelPublicationAttemptUseCase(
      postRepository,
      unitOfWork
    ),
  };
  return wiring;
}

export { verifyDatabaseAuth };
