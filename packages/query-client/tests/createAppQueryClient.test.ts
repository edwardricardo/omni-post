/**
 * @file createAppQueryClient.test.ts
 * @description Unit tests for the shared QueryClient factory — verifies default config,
 *              overridable options, and global error handler routing (logger + optional
 *              consumer callbacks for queries and mutations).
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { createAppQueryClient, type QueryClientLogger } from "../src/index.js";

function makeLogger(): QueryClientLogger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    warn: vi.fn<(message: string, data?: Record<string, unknown>) => void>(),
    error: vi.fn<(message: string, error?: unknown, data?: Record<string, unknown>) => void>(),
  };
}

describe("createAppQueryClient", () => {
  describe("defaults", () => {
    it("applies staleTime=60s, gcTime=5min, retry=1 by default", () => {
      const client = createAppQueryClient({ logger: makeLogger() });
      const defaults = client.getDefaultOptions();
      expect(defaults.queries?.staleTime).toBe(60_000);
      expect(defaults.queries?.gcTime).toBe(5 * 60_000);
      expect(defaults.queries?.retry).toBe(1);
    });

    it("disables retry on mutations by default (0)", () => {
      const client = createAppQueryClient({ logger: makeLogger() });
      const defaults = client.getDefaultOptions();
      expect(defaults.mutations?.retry).toBe(0);
    });
  });

  describe("overrides", () => {
    it("respects custom staleTime / gcTime / retry", () => {
      const client = createAppQueryClient({
        logger: makeLogger(),
        staleTime: 10_000,
        gcTime: 30_000,
        retry: 3,
      });
      const defaults = client.getDefaultOptions();
      expect(defaults.queries?.staleTime).toBe(10_000);
      expect(defaults.queries?.gcTime).toBe(30_000);
      expect(defaults.queries?.retry).toBe(3);
    });
  });

  describe("query error routing", () => {
    it("logs the error and calls onQueryError when a query fails", async () => {
      const logger = makeLogger();
      const onQueryError = vi.fn();
      const client = createAppQueryClient({ logger, onQueryError });

      await client
        .fetchQuery({
          queryKey: ["unit-test", "fail"],
          queryFn: async () => {
            throw new Error("boom");
          },
          retry: 0,
        })
        .catch(() => {
          /* expected */
        });

      expect(logger.error).toHaveBeenCalledWith(
        "Query failed",
        expect.any(Error),
        expect.objectContaining({ queryKey: ["unit-test", "fail"] })
      );
      expect(onQueryError).toHaveBeenCalledTimes(1);
    });

    it("does not throw if onQueryError is not provided", async () => {
      const logger = makeLogger();
      const client = createAppQueryClient({ logger });

      await expect(
        client.fetchQuery({
          queryKey: ["unit-test", "fail-no-handler"],
          queryFn: async () => {
            throw new Error("boom");
          },
          retry: 0,
        })
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("mutation error routing", () => {
    it("logs the error and calls onMutationError when a mutation fails", async () => {
      const logger = makeLogger();
      const onMutationError = vi.fn();
      const client = createAppQueryClient({ logger, onMutationError });

      const observer = client.getMutationCache();
      const mutation = observer.build(client, {
        mutationKey: ["unit-test", "mutate-fail"],
        mutationFn: async () => {
          throw new Error("mutation-boom");
        },
        retry: 0,
      });

      await mutation.execute(undefined as never).catch(() => {
        /* expected */
      });

      expect(logger.error).toHaveBeenCalledWith(
        "Mutation failed",
        expect.any(Error),
        expect.objectContaining({ mutationKey: ["unit-test", "mutate-fail"] })
      );
      expect(onMutationError).toHaveBeenCalledTimes(1);
    });
  });
});
