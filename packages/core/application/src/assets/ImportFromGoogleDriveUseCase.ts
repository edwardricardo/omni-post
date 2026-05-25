/**
 * @file ImportFromGoogleDriveUseCase.ts
 * @description Orchestrates importing a file from Google Drive into the Asset Library.
 *   The client-side Google Picker provides the file ID and access token. This use case
 *   validates the MIME type, constructs a MediaAsset entity with Google Drive metadata,
 *   and persists it via the repository. Actual storage upload is deferred to a background
 *   job — the Google Drive download URL is stored as the asset URL.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type MediaAssetRepository } from "@core/domain/repositories/MediaAssetRepository.js";
import { MediaAsset } from "@core/domain/entities/MediaAsset.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

/**
 * Supported MIME type prefixes for Google Drive imports.
 */
const SUPPORTED_MIME_PREFIXES = ["image/", "video/"] as const;

/**
 * Input DTO for importing a file from Google Drive.
 */
export interface ImportFromGoogleDriveInput {
  /** OmniPost account ID (from auth context) */
  accountId: string;
  /** Optional project to associate the asset with */
  projectId?: string;
  /** Google Drive file ID (from Picker API) */
  fileId: string;
  /** User's Google OAuth access token (from Picker session) */
  accessToken: string;
  /** Original file name as reported by Google Drive */
  fileName: string;
  /** MIME type of the file (e.g. "image/jpeg", "video/mp4") */
  mimeType: string;
  /** OmniPost AssetFolder ID to place the imported asset in */
  folderId?: string;
}

/**
 * Output DTO for a successfully imported Google Drive asset.
 */
export interface ImportFromGoogleDriveOutput {
  id: string;
  fileName: string;
  mimeType: string;
  type: "image" | "video";
  googleDriveFileId: string;
  url: string;
}

/**
 * @class ImportFromGoogleDriveUseCase
 * @description Validates MIME type, builds a MediaAsset entity with Google Drive metadata,
 *   and persists it. The actual binary download + S3 upload is deferred to a background job.
 */
export class ImportFromGoogleDriveUseCase implements UseCase<
  ImportFromGoogleDriveInput,
  ImportFromGoogleDriveOutput,
  UseCaseError
> {
  constructor(
    private readonly mediaAssetRepository: MediaAssetRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Imports a Google Drive file reference into the Asset Library.
   * @param input - Validated import parameters (fileId, accessToken, fileName, mimeType)
   * @returns Result<ImportFromGoogleDriveOutput> on success, UseCaseError on failure
   */
  async execute(
    input: ImportFromGoogleDriveInput
  ): Promise<Result<ImportFromGoogleDriveOutput, UseCaseError>> {
    // 1. Validate required fields
    if (!input.fileId || input.fileId.trim().length === 0) {
      return err(
        new UseCaseError("Google Drive file ID is required", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    if (!input.accessToken || input.accessToken.trim().length === 0) {
      return err(
        new UseCaseError("Google access token is required", USE_CASE_ERRORS.VALIDATION_FAILED)
      );
    }

    if (!input.fileName || input.fileName.trim().length === 0) {
      return err(new UseCaseError("File name is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    if (!input.mimeType || input.mimeType.trim().length === 0) {
      return err(new UseCaseError("MIME type is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    // 2. Validate MIME type (must be image/* or video/*)
    const isSupportedMime = SUPPORTED_MIME_PREFIXES.some((prefix) =>
      input.mimeType.startsWith(prefix)
    );

    if (!isSupportedMime) {
      return err(
        new UseCaseError(
          `Unsupported MIME type "${input.mimeType}". Only image/* and video/* files are allowed.`,
          USE_CASE_ERRORS.VALIDATION_FAILED
        )
      );
    }

    // 3. Determine asset type from MIME
    const assetType: "image" | "video" = input.mimeType.startsWith("image/") ? "image" : "video";

    // 4. Build Google Drive download URL (stored as asset URL until background job uploads to S3)
    const googleDriveUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}?alt=media`;

    // 5. Create MediaAsset entity
    const createResult = MediaAsset.create({
      accountId: input.accountId,
      ...(input.projectId !== undefined && { projectId: input.projectId }),
      name: input.fileName.trim(),
      url: googleDriveUrl,
      storageKey: `google-drive/${input.fileId}`,
      mimeType: input.mimeType,
      sizeBytes: 0, // Unknown until background job downloads the file
      ...(input.folderId !== undefined && { folderId: input.folderId }),
    });

    if (!createResult.ok) {
      return err(
        new UseCaseError(
          createResult.error.message,
          USE_CASE_ERRORS.VALIDATION_FAILED,
          createResult.error
        )
      );
    }

    const asset = createResult.value;

    // 6. Persist via repository (atomically via UoW when available)
    const doWork = async (): Promise<Result<ImportFromGoogleDriveOutput, UseCaseError>> => {
      const saveResult = await this.mediaAssetRepository.save(asset);
      if (!saveResult.ok) {
        return err(
          new UseCaseError(
            "Failed to save imported Google Drive asset",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            saveResult.error
          )
        );
      }

      return ok({
        id: asset.id.value,
        fileName: asset.name,
        mimeType: asset.mimeType,
        type: assetType,
        googleDriveFileId: input.fileId,
        url: googleDriveUrl,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ImportFromGoogleDriveOutput, UseCaseError> = ok({
          id: asset.id.value,
          fileName: asset.name,
          mimeType: asset.mimeType,
          type: assetType,
          googleDriveFileId: input.fileId,
          url: googleDriveUrl,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to save imported Google Drive asset",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
