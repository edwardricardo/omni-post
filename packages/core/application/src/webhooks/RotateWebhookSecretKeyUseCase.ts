/**
 * @file RotateWebhookSecretKeyUseCase.ts
 * @description Admin-triggered rotation of WebhookSubscription.secretKey with
 *              a configurable grace window. Generates a new HMAC secret,
 *              moves the current value to `previousSecretKey`, and stamps
 *              `previousSecretKeyExpiresAt = now + graceWindowHours`. The
 *              HMAC verifier in `webhookHandlerCore` accepts signatures
 *              produced with either secret while the window is open.
 * @layer application
 */

import { randomBytes } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { WebhookSubscriptionRotationRepository } from "./WebhookSubscriptionRotationRepository.js";

const MIN_GRACE_HOURS = 1;
const MAX_GRACE_HOURS = 24 * 7;
const DEFAULT_GRACE_HOURS = 24;
const SECRET_BYTE_LENGTH = 32;

export interface RotateWebhookSecretKeyInput {
  webhookSubscriptionId: string;
  graceWindowHours?: number;
}

export interface RotateWebhookSecretKeyOutput {
  webhookSubscriptionId: string;
  newSecretKey: string;
  previousSecretKeyExpiresAt: string;
  graceWindowHours: number;
}

export class RotateWebhookSecretKeyUseCase implements UseCase<
  RotateWebhookSecretKeyInput,
  RotateWebhookSecretKeyOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: WebhookSubscriptionRotationRepository,
    private readonly unitOfWork?: UnitOfWork,
    private readonly secretFactory: () => string = () =>
      randomBytes(SECRET_BYTE_LENGTH).toString("hex"),
    private readonly clock: () => Date = () => new Date()
  ) {}

  async execute(
    input: RotateWebhookSecretKeyInput
  ): Promise<Result<RotateWebhookSecretKeyOutput, UseCaseError>> {
    if (!input.webhookSubscriptionId.trim()) {
      return err(
        new UseCaseError("webhookSubscriptionId is required", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    const graceHours = input.graceWindowHours ?? DEFAULT_GRACE_HOURS;
    if (
      !Number.isFinite(graceHours) ||
      graceHours < MIN_GRACE_HOURS ||
      graceHours > MAX_GRACE_HOURS
    ) {
      return err(
        new UseCaseError(
          `graceWindowHours must be between ${MIN_GRACE_HOURS} and ${MAX_GRACE_HOURS}`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    const current = await this.repository.findById(input.webhookSubscriptionId);
    if (!current) {
      return err(
        new UseCaseError(
          `Webhook subscription not found: ${input.webhookSubscriptionId}`,
          USE_CASE_ERRORS.NOT_FOUND
        )
      );
    }

    const newSecret = this.secretFactory();
    const expiresAt = new Date(this.clock().getTime() + graceHours * 60 * 60 * 1000);

    const doWork = async (): Promise<Result<RotateWebhookSecretKeyOutput, UseCaseError>> => {
      const saved = await this.repository.rotateSecret({
        id: input.webhookSubscriptionId,
        newSecretKey: newSecret,
        previousSecretKey: current.secretKey,
        previousSecretKeyExpiresAt: expiresAt,
      });
      if (!saved) {
        return err(
          new UseCaseError(
            "Failed to persist webhook secret rotation",
            USE_CASE_ERRORS.INTERNAL_ERROR
          )
        );
      }
      return ok({
        webhookSubscriptionId: input.webhookSubscriptionId,
        newSecretKey: newSecret,
        previousSecretKeyExpiresAt: expiresAt.toISOString(),
        graceWindowHours: graceHours,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<RotateWebhookSecretKeyOutput, UseCaseError> = err(
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
          "Failed to rotate webhook secret",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
