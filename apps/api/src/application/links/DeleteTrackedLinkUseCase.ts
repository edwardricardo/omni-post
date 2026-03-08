/**
 * Application Layer - Delete Tracked Link Use Case
 *
 * Part of Sprint 19: Link Tracking Feature
 * Handles deletion of tracked links.
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { TrackedLinkId, type TrackedLinkRepository } from "../../domain/index.js";
import { type DeleteLinkInput } from "./types.js";

/**
 * Delete Tracked Link Use Case
 *
 * Deletes a tracked link and all associated click data.
 */
export class DeleteTrackedLinkUseCase implements UseCase<DeleteLinkInput, void, UseCaseError> {
  constructor(private readonly repository: TrackedLinkRepository) {}

  async execute(input: DeleteLinkInput): Promise<Result<void, UseCaseError>> {
    // Validate link ID
    const linkIdResult = TrackedLinkId.fromString(input.linkId);
    if (!linkIdResult.ok) {
      return err(
        new UseCaseError(`Invalid link ID: ${input.linkId}`, USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    // Verify link exists
    const findResult = await this.repository.findById(linkIdResult.value);
    if (!findResult.ok) {
      return err(
        new UseCaseError(
          `Tracked link not found: ${input.linkId}`,
          USE_CASE_ERRORS.NOT_FOUND,
          findResult.error
        )
      );
    }

    // Delete the link
    const deleteResult = await this.repository.delete(linkIdResult.value);
    if (!deleteResult.ok) {
      return err(
        new UseCaseError(
          "Failed to delete tracked link",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          deleteResult.error
        )
      );
    }

    return ok(undefined);
  }
}
