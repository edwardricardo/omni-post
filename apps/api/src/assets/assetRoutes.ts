/**
 * @file assetRoutes.ts
 * @description Fastify plugin registering Asset Library management endpoints.
 *   Resolves use cases, queries, and repositories from DI and delegates to
 *   AssetRouteHandler. Supports media assets, tags, and folders CRUD.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";

// Use case / query types (type-only imports)
import type { CreateMediaAssetUseCase } from "../application/assets/CreateMediaAssetUseCase.js";
import type { UpdateMediaAssetUseCase } from "../application/assets/UpdateMediaAssetUseCase.js";
import type { DeleteMediaAssetUseCase } from "../application/assets/DeleteMediaAssetUseCase.js";
import type { TagMediaAssetUseCase } from "../application/assets/TagMediaAssetUseCase.js";
import type { GetMediaAssetsQuery } from "../application/assets/GetMediaAssetsQuery.js";
import type { CreateAssetTagUseCase } from "../application/assets/CreateAssetTagUseCase.js";
import type { ListAssetTagsQuery } from "../application/assets/ListAssetTagsQuery.js";
import type { CreateAssetFolderUseCase } from "../application/assets/CreateAssetFolderUseCase.js";
import type { ImportFromGoogleDriveUseCase } from "../application/assets/ImportFromGoogleDriveUseCase.js";
import type { AssetTagRepository } from "../domain/repositories/AssetTagRepository.js";
import type { AssetFolderRepository } from "../domain/repositories/AssetFolderRepository.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const UuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const CreateAssetBodySchema = z.object({
  name: z.string().min(1, { message: "Asset name must not be empty" }).max(255),
  url: z.string().url(),
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  projectId: z.string().uuid().optional(),
  description: z.string().max(1000).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().nonnegative().optional(),
  folderId: z.string().uuid().optional(),
});

const UpdateAssetBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

const ListAssetsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullable().optional(),
  tagIds: z.string().optional(),
  mimeType: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().nullable().optional(),
});

const TagAssetBodySchema = z.object({
  tagIds: z.array(z.string().uuid()),
});

const CreateTagBodySchema = z.object({
  name: z.string().min(1, { message: "Tag name must not be empty" }).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const CreateFolderBodySchema = z.object({
  name: z.string().min(1, { message: "Folder name must not be empty" }).max(100),
  parentId: z.string().uuid().optional(),
});

const ImportGoogleDriveBodySchema = z.object({
  fileId: z.string().min(1, { message: "Google Drive file ID is required" }),
  accessToken: z.string().min(1, { message: "Google access token is required" }),
  fileName: z.string().min(1, { message: "File name is required" }).max(255),
  mimeType: z.string().min(1, { message: "MIME type is required" }),
  folderId: z.string().uuid().optional(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

/**
 * @class AssetRouteHandler
 * @description Handles all Asset Library HTTP endpoints, delegating business
 *   logic to the respective use cases and queries resolved from DI.
 */
class AssetRouteHandler extends BaseRouteHandler {
  protected routeName = "assets";

  constructor(
    private readonly createAssetUseCase: CreateMediaAssetUseCase,
    private readonly updateAssetUseCase: UpdateMediaAssetUseCase,
    private readonly deleteAssetUseCase: DeleteMediaAssetUseCase,
    private readonly tagAssetUseCase: TagMediaAssetUseCase,
    private readonly getAssetsQuery: GetMediaAssetsQuery,
    private readonly createTagUseCase: CreateAssetTagUseCase,
    private readonly listTagsQuery: ListAssetTagsQuery,
    private readonly createFolderUseCase: CreateAssetFolderUseCase,
    private readonly assetTagRepository: AssetTagRepository,
    private readonly assetFolderRepository: AssetFolderRepository,
    private readonly importFromGoogleDriveUseCase: ImportFromGoogleDriveUseCase
  ) {
    super();
  }

  /**
   * @method mapErrorCode
   * @description Maps UseCaseError.code to an HTTP status code.
   */
  private mapErrorCode(code: string): number {
    const mapping: Record<string, number> = {
      VALIDATION_FAILED: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    };
    return mapping[code] ?? 500;
  }

  /**
   * @method getAccountId
   * @description Extracts accountId from the authenticated user.
   */
  private getAccountId(request: FastifyRequest): string | null {
    return request.user?.accountId ?? request.user?.id ?? null;
  }

  // --------------------------------------------------------------------------
  // Media Asset endpoints
  // --------------------------------------------------------------------------

  /**
   * @method listAssets
   * @description GET /api/assets -- Lists media assets with filters and pagination.
   */
  async listAssets(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const queryValidation = await this.validateQuery(ctx, ListAssetsQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const q = queryValidation.value;
    const tagIds =
      q.tagIds !== undefined ? q.tagIds.split(",").filter((s) => s.length > 0) : undefined;

    const result = await this.getAssetsQuery.execute({
      accountId,
      ...(q.projectId !== undefined && { projectId: q.projectId }),
      ...(q.folderId !== undefined && { folderId: q.folderId }),
      ...(tagIds !== undefined && { tagIds }),
      ...(q.mimeType !== undefined && { mimeType: q.mimeType }),
      ...(q.search !== undefined && { search: q.search }),
      ...(q.limit !== undefined && { limit: q.limit }),
      ...(q.cursor !== undefined && { cursor: q.cursor }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    // Serialize MediaAsset entities to plain objects
    const serialized = {
      ...result.value,
      items: result.value.items.map((item) => item.toJSON()),
    };

    this.sendSuccess(ctx, serialized);
  }

  /**
   * @method createAsset
   * @description POST /api/assets -- Creates a new media asset.
   */
  async createAsset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const bodyValidation = await this.validateBody(ctx, CreateAssetBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.createAssetUseCase.execute({
      accountId,
      name: body.name,
      url: body.url,
      storageKey: body.storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      ...(body.projectId !== undefined && { projectId: body.projectId }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.width !== undefined && { width: body.width }),
      ...(body.height !== undefined && { height: body.height }),
      ...(body.duration !== undefined && { duration: body.duration }),
      ...(body.folderId !== undefined && { folderId: body.folderId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method getAsset
   * @description GET /api/assets/:id -- Gets a single media asset by ID.
   */
  async getAsset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid asset ID format");
    }

    // Use the query with a limit of 1 to avoid resolving the repo directly.
    // However, using findMany for single-item lookup is wasteful. Instead,
    // resolve the repo inline (same pattern as reportRoutes getReport).
    const mediaAssetRepo = request.server.container.resolve<
      import("../domain/repositories/MediaAssetRepository.js").MediaAssetRepository
    >(TOKENS.MediaAssetRepository);

    const asset = await mediaAssetRepo.findById(paramsValidation.value.id, accountId);
    if (!asset) {
      return this.sendError(ctx, 404, "Media asset not found");
    }

    this.sendSuccess(ctx, asset.toJSON());
  }

  /**
   * @method updateAsset
   * @description PATCH /api/assets/:id -- Updates a media asset.
   */
  async updateAsset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid asset ID format");
    }

    const bodyValidation = await this.validateBody(ctx, UpdateAssetBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.updateAssetUseCase.execute({
      id: paramsValidation.value.id,
      accountId,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.folderId !== undefined && { folderId: body.folderId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method deleteAsset
   * @description DELETE /api/assets/:id -- Soft-deletes a media asset.
   */
  async deleteAsset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid asset ID format");
    }

    const result = await this.deleteAssetUseCase.execute({
      id: paramsValidation.value.id,
      accountId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { id: paramsValidation.value.id, status: "deleted" });
  }

  /**
   * @method tagAsset
   * @description POST /api/assets/:id/tags -- Replaces tags on a media asset.
   */
  async tagAsset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid asset ID format");
    }

    const bodyValidation = await this.validateBody(ctx, TagAssetBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const result = await this.tagAssetUseCase.execute({
      assetId: paramsValidation.value.id,
      accountId,
      tagIds: bodyValidation.value.tagIds,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { assetId: paramsValidation.value.id, status: "tags_updated" });
  }

  // --------------------------------------------------------------------------
  // Import endpoints
  // --------------------------------------------------------------------------

  /**
   * @method importFromGoogleDrive
   * @description POST /api/assets/import/google-drive -- Imports a file from Google Drive.
   */
  async importFromGoogleDrive(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const bodyValidation = await this.validateBody(ctx, ImportGoogleDriveBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.importFromGoogleDriveUseCase.execute({
      accountId,
      fileId: body.fileId,
      accessToken: body.accessToken,
      fileName: body.fileName,
      mimeType: body.mimeType,
      ...(body.folderId !== undefined && { folderId: body.folderId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  // --------------------------------------------------------------------------
  // Tag endpoints
  // --------------------------------------------------------------------------

  /**
   * @method listTags
   * @description GET /api/assets/tags -- Lists all asset tags for the account.
   */
  async listTags(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.listTagsQuery.execute({ accountId });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method createTag
   * @description POST /api/assets/tags -- Creates a new asset tag.
   */
  async createTag(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const bodyValidation = await this.validateBody(ctx, CreateTagBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.createTagUseCase.execute({
      accountId,
      name: body.name,
      ...(body.color !== undefined && { color: body.color }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method deleteTag
   * @description DELETE /api/assets/tags/:id -- Deletes an asset tag.
   */
  async deleteTag(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid tag ID format");
    }

    const result = await this.assetTagRepository.delete(paramsValidation.value.id, accountId);
    if (!result.ok) {
      return this.sendError(ctx, 404, result.error.message);
    }

    this.sendSuccess(ctx, { id: paramsValidation.value.id, status: "deleted" });
  }

  // --------------------------------------------------------------------------
  // Folder endpoints
  // --------------------------------------------------------------------------

  /**
   * @method listFolders
   * @description GET /api/assets/folders -- Lists all asset folders for the account.
   */
  async listFolders(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const folders = await this.assetFolderRepository.findByAccount(accountId);
    this.sendSuccess(ctx, folders);
  }

  /**
   * @method createFolder
   * @description POST /api/assets/folders -- Creates a new asset folder.
   */
  async createFolder(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const accountId = this.getAccountId(request);
    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const bodyValidation = await this.validateBody(ctx, CreateFolderBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.createFolderUseCase.execute({
      accountId,
      name: body.name,
      ...(body.parentId !== undefined && { parentId: body.parentId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

/**
 * Fastify plugin that registers Asset Library routes under /api/assets.
 */
const assetRoutes: FastifyPluginAsync = async (app) => {
  const handler = new AssetRouteHandler(
    app.container.resolve<CreateMediaAssetUseCase>(TOKENS.CreateMediaAssetUseCase),
    app.container.resolve<UpdateMediaAssetUseCase>(TOKENS.UpdateMediaAssetUseCase),
    app.container.resolve<DeleteMediaAssetUseCase>(TOKENS.DeleteMediaAssetUseCase),
    app.container.resolve<TagMediaAssetUseCase>(TOKENS.TagMediaAssetUseCase),
    app.container.resolve<GetMediaAssetsQuery>(TOKENS.GetMediaAssetsQuery),
    app.container.resolve<CreateAssetTagUseCase>(TOKENS.CreateAssetTagUseCase),
    app.container.resolve<ListAssetTagsQuery>(TOKENS.ListAssetTagsQuery),
    app.container.resolve<CreateAssetFolderUseCase>(TOKENS.CreateAssetFolderUseCase),
    app.container.resolve<AssetTagRepository>(TOKENS.AssetTagRepository),
    app.container.resolve<AssetFolderRepository>(TOKENS.AssetFolderRepository),
    app.container.resolve<ImportFromGoogleDriveUseCase>(TOKENS.ImportFromGoogleDriveUseCase)
  );

  // -- Tag routes (registered BEFORE parameterized asset routes to avoid conflicts) --

  app.get(
    "/api/assets/tags",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "List asset tags" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listTags(request, reply)
  );

  app.post(
    "/api/assets/tags",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Create asset tag" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createTag(request, reply)
  );

  app.delete(
    "/api/assets/tags/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Delete asset tag" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deleteTag(request, reply)
  );

  // -- Folder routes --

  app.get(
    "/api/assets/folders",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "List asset folders" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listFolders(request, reply)
  );

  app.post(
    "/api/assets/folders",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Create asset folder" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createFolder(request, reply)
  );

  // -- Import routes (before parameterized asset routes to avoid conflicts) --

  app.post(
    "/api/assets/import/google-drive",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Import file from Google Drive" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.importFromGoogleDrive(request, reply)
  );

  // -- Media Asset routes --

  app.get(
    "/api/assets",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "List media assets" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listAssets(request, reply)
  );

  app.post(
    "/api/assets",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Create media asset" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.createAsset(request, reply)
  );

  app.get(
    "/api/assets/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Get media asset by ID" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.getAsset(request, reply)
  );

  app.patch(
    "/api/assets/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Update media asset" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.updateAsset(request, reply)
  );

  app.delete(
    "/api/assets/:id",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Delete media asset" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deleteAsset(request, reply)
  );

  app.post(
    "/api/assets/:id/tags",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Assets"], summary: "Tag media asset" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.tagAsset(request, reply)
  );
};

export { assetRoutes };
