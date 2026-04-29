/**
 * @file ConcurrentRenderer.tsx
 * @description React 19 concurrent renderer for scalability: time-slicing,
 *              priority-based rendering, background fetching with Suspense,
 *              selective hydration, and concurrent state updates.
 * @layer infrastructure
 */

"use client";

import React, {
  Suspense,
  useTransition,
  useDeferredValue,
  startTransition,
  useMemo,
  useCallback,
  useState,
  useEffect,
} from "react";

interface ConcurrentRendererProps {
  children: React.ReactNode;
  fallback?: React.ComponentType;
  priority?: "high" | "normal" | "low";
  enableTimeSlicing?: boolean;
  backgroundRefresh?: boolean;
}

/**
 * Concurrent Renderer with React 19 time-slicing and priority scheduling
 */
export function ConcurrentRenderer({
  children,
  fallback: FallbackComponent,
  priority = "normal",
  enableTimeSlicing = true,
  backgroundRefresh: _backgroundRefresh = false,
}: ConcurrentRendererProps) {
  const [isPending, _startTransition] = useTransition();

  // Deferred values for non-critical updates
  const deferredChildren = useDeferredValue(children);

  // Render based on priority
  const renderChildren = useMemo(() => {
    if (priority === "high") {
      return children; // Immediate rendering
    }

    if (enableTimeSlicing && priority === "low") {
      return deferredChildren; // Deferred rendering
    }

    return children;
  }, [children, deferredChildren, priority, enableTimeSlicing]);

  return (
    <Suspense fallback={FallbackComponent ? <FallbackComponent /> : <DefaultFallback />}>
      <div className={isPending ? "opacity-90 transition-opacity" : ""}>{renderChildren}</div>
    </Suspense>
  );
}

/**
 * Concurrent Data Fetcher with background refresh
 */
export function useConcurrentData<T>(
  fetchData: () => Promise<T>,
  dependencies: React.DependencyList,
  options?: {
    refreshInterval?: number;
    backgroundRefresh?: boolean;
    priority?: "high" | "normal" | "low";
    retryCount?: number;
  }
) {
  const {
    refreshInterval = 0,
    backgroundRefresh = true,
    priority = "normal",
    retryCount = 3,
  } = options || {};

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Memoize fetch function. `...dependencies` is a caller-provided spread so
  // ESLint cannot statically verify the dep list — the hook contract is that
  // the caller owns stability of those deps.
  const memoizedFetchData = useCallback(() => {
    return fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-owned spread
  }, [fetchData, ...dependencies]);

  // Background data fetching
  const fetchWithRetry = useCallback(
    async (attempt = 1): Promise<void> => {
      try {
        const result = await memoizedFetchData();

        if (priority === "high") {
          // Immediate update for high priority
          setData(result);
          setError(null);
          setIsLoading(false);
        } else {
          // Deferred update for normal/low priority
          startTransition(() => {
            setData(result);
            setError(null);
            setIsLoading(false);
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Unknown error");

        if (attempt < retryCount) {
          // Exponential backoff retry
          setTimeout(
            () => {
              fetchWithRetry(attempt + 1);
            },
            Math.pow(2, attempt) * 1000
          );
        } else {
          if (priority === "high") {
            setError(error);
            setIsLoading(false);
          } else {
            startTransition(() => {
              setError(error);
              setIsLoading(false);
            });
          }
        }
      }
    },
    [memoizedFetchData, priority, retryCount]
  );

  // Initial data fetch
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetchWithRetry();
  }, [fetchWithRetry]);

  // Background refresh interval
  useEffect(() => {
    if (refreshInterval > 0 && backgroundRefresh) {
      const interval = setInterval(() => {
        // Background refresh without showing loading state
        startTransition(() => {
          fetchWithRetry();
        });
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [refreshInterval, backgroundRefresh, fetchWithRetry]);

  // Manual refresh function
  const refresh = useCallback(() => {
    if (priority === "high") {
      setIsLoading(true);
      fetchWithRetry();
    } else {
      startTransition(() => {
        setIsLoading(true);
        fetchWithRetry();
      });
    }
  }, [fetchWithRetry, priority]);

  return {
    data,
    error,
    isLoading,
    isPending,
    refresh,
  };
}

/**
 * Priority-based List Renderer for large datasets
 */
interface PriorityListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  priority?: "high" | "normal" | "low";
  batchSize?: number;
  className?: string;
}

export function PriorityList<T>({
  items,
  renderItem,
  keyExtractor,
  priority = "normal",
  batchSize = 50,
  className = "",
}: PriorityListProps<T>) {
  const [renderedCount, setRenderedCount] = useState(batchSize);
  const [isPending, startTransition] = useTransition();

  // Deferred rendered count for smooth updates
  const deferredRenderedCount = useDeferredValue(renderedCount);

  // Items to render based on priority and count
  const itemsToRender = useMemo(() => {
    const count = priority === "high" ? renderedCount : deferredRenderedCount;
    return items.slice(0, Math.min(count, items.length));
  }, [items, renderedCount, deferredRenderedCount, priority]);

  // Load more items
  const loadMore = useCallback(() => {
    if (renderedCount < items.length) {
      if (priority === "high") {
        setRenderedCount((prev) => Math.min(prev + batchSize, items.length));
      } else {
        startTransition(() => {
          setRenderedCount((prev) => Math.min(prev + batchSize, items.length));
        });
      }
    }
  }, [renderedCount, items.length, batchSize, priority]);

  // Auto-load more on scroll
  useEffect(() => {
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;

      if (scrollTop + clientHeight >= scrollHeight - 1000) {
        // 1000px before end
        loadMore();
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  return (
    <div className={`${className} ${isPending ? "opacity-90 transition-opacity" : ""}`}>
      {itemsToRender.map((item, index) => (
        <React.Fragment key={keyExtractor(item, index)}>{renderItem(item, index)}</React.Fragment>
      ))}

      {renderedCount < items.length && (
        <div className="flex justify-center p-4">
          <button
            onClick={loadMore}
            disabled={isPending}
            className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {isPending ? "Loading..." : `Load More (${items.length - renderedCount} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Concurrent Form Handler with optimistic updates
 */
interface ConcurrentFormProps {
  onSubmit: (data: FormData) => Promise<unknown>;
  children: React.ReactNode;
  optimisticUpdate?: (data: FormData) => void;
  className?: string;
}

export function ConcurrentForm({
  onSubmit,
  children,
  optimisticUpdate,
  className = "",
}: ConcurrentFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const formData = new FormData(event.currentTarget);

      // Optimistic update
      if (optimisticUpdate) {
        optimisticUpdate(formData);
      }

      // Async form submission
      startTransition(async () => {
        try {
          await onSubmit(formData);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Submission failed");
        }
      });
    },
    [onSubmit, optimisticUpdate]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={`${className} ${isPending ? "opacity-75 pointer-events-none" : ""}`}
    >
      {children}

      {error && <div className="mt-2 p-2 bg-red-100 text-red-700 rounded-sm text-sm">{error}</div>}

      {isPending && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
        </div>
      )}
    </form>
  );
}

/**
 * Selective Hydration Component for performance
 */
interface SelectiveHydrationProps {
  children: React.ReactNode;
  hydrationPriority?: "high" | "normal" | "low" | "idle";
  fallback?: React.ComponentType;
}

export function SelectiveHydration({
  children,
  hydrationPriority = "normal",
  fallback: FallbackComponent,
}: SelectiveHydrationProps) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const hydrate = () => {
      setIsHydrated(true);
    };

    switch (hydrationPriority) {
      case "high":
        hydrate(); // Immediate hydration
        break;
      case "normal":
        startTransition(hydrate); // Deferred hydration
        break;
      case "low":
        setTimeout(() => startTransition(hydrate), 100); // Delayed hydration
        break;
      case "idle":
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(hydrate);
        } else {
          setTimeout(hydrate, 1000);
        }
        break;
    }
  }, [hydrationPriority]);

  if (!isHydrated) {
    return FallbackComponent ? <FallbackComponent /> : <DefaultFallback />;
  }

  return <>{children}</>;
}

/**
 * Background Task Manager for concurrent operations
 */
export function useBackgroundTasks() {
  const [tasks, setTasks] = useState<Map<string, Promise<unknown>>>(new Map());
  const [results, setResults] = useState<Map<string, unknown>>(new Map());
  const [errors, setErrors] = useState<Map<string, Error>>(new Map());

  const runBackgroundTask = useCallback(
    <T,>(
      taskId: string,
      task: () => Promise<T>,
      options?: { priority?: "high" | "normal" | "low" }
    ) => {
      const { priority = "normal" } = options || {};

      const taskPromise = task();

      setTasks((prev) => new Map(prev).set(taskId, taskPromise));

      const handleTaskCompletion = async () => {
        try {
          const result = await taskPromise;

          if (priority === "high") {
            setResults((prev) => new Map(prev).set(taskId, result));
          } else {
            startTransition(() => {
              setResults((prev) => new Map(prev).set(taskId, result));
            });
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error("Task failed");

          if (priority === "high") {
            setErrors((prev) => new Map(prev).set(taskId, err));
          } else {
            startTransition(() => {
              setErrors((prev) => new Map(prev).set(taskId, err));
            });
          }
        } finally {
          startTransition(() => {
            setTasks((prev) => {
              const newTasks = new Map(prev);
              newTasks.delete(taskId);
              return newTasks;
            });
          });
        }
      };

      handleTaskCompletion();

      return taskPromise;
    },
    []
  );

  const getTaskStatus = useCallback(
    (taskId: string) => {
      return {
        isRunning: tasks.has(taskId),
        result: results.get(taskId),
        error: errors.get(taskId),
      };
    },
    [tasks, results, errors]
  );

  const clearTask = useCallback((taskId: string) => {
    startTransition(() => {
      setResults((prev) => {
        const newResults = new Map(prev);
        newResults.delete(taskId);
        return newResults;
      });
      setErrors((prev) => {
        const newErrors = new Map(prev);
        newErrors.delete(taskId);
        return newErrors;
      });
    });
  }, []);

  return {
    runBackgroundTask,
    getTaskStatus,
    clearTask,
    activeTasks: Array.from(tasks.keys()),
  };
}

// Default fallback component
function DefaultFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
      <span className="ml-2 text-gray-600">Loading...</span>
    </div>
  );
}

/**
 * Performance monitoring for concurrent features
 */
export function usePerformanceMonitoring() {
  const [metrics, setMetrics] = useState({
    renderCount: 0,
    averageRenderTime: 0,
    concurrentUpdates: 0,
    backgroundTasks: 0,
  });

  const recordRender = useCallback((renderTime: number) => {
    startTransition(() => {
      setMetrics((prev) => ({
        ...prev,
        renderCount: prev.renderCount + 1,
        averageRenderTime:
          (prev.averageRenderTime * (prev.renderCount - 1) + renderTime) / prev.renderCount,
      }));
    });
  }, []);

  const recordConcurrentUpdate = useCallback(() => {
    startTransition(() => {
      setMetrics((prev) => ({
        ...prev,
        concurrentUpdates: prev.concurrentUpdates + 1,
      }));
    });
  }, []);

  const recordBackgroundTask = useCallback(() => {
    startTransition(() => {
      setMetrics((prev) => ({
        ...prev,
        backgroundTasks: prev.backgroundTasks + 1,
      }));
    });
  }, []);

  return {
    metrics,
    recordRender,
    recordConcurrentUpdate,
    recordBackgroundTask,
  };
}
