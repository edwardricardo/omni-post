/**
 * @file VirtualScrollList.tsx
 * @description High-performance virtual scrolling component rendering only visible
 *              items. Supports dynamic item heights with accurate scroll positioning,
 *              infinite scroll capabilities, and React 19 concurrent features.
 * @component VirtualScrollList
 * @layer infrastructure
 */

"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useTransition,
  startTransition,
} from "react";
import { ConsoleLoggerAdapter } from "@observability/browser-logger";

const virtualScrollListLogger = new ConsoleLoggerAdapter("VirtualScrollList");

interface VirtualScrollListProps<T> {
  items: T[];
  itemHeight?: number | ((index: number, item: T) => number);
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  height: number;
  width?: string | number;
  overscan?: number;
  onLoadMore?: () => void;
  hasNextPage?: boolean;
  isLoading?: boolean;
  className?: string;
  loadingComponent?: React.ComponentType;
  emptyComponent?: React.ComponentType;
  scrollToIndex?: number;
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  direction?: "vertical" | "horizontal";
}

interface ScrollState {
  scrollTop: number;
  scrollLeft: number;
}

interface ItemMetadata {
  offset: number;
  size: number;
}

export function VirtualScrollList<T>({
  items,
  itemHeight = 50,
  renderItem,
  height,
  width = "100%",
  overscan = 5,
  onLoadMore,
  hasNextPage = false,
  isLoading = false,
  className = "",
  loadingComponent: LoadingComponent,
  emptyComponent: EmptyComponent,
  scrollToIndex,
  onScroll,
  direction = "vertical",
}: VirtualScrollListProps<T>) {
  const [isPending, startTransition] = useTransition();
  const [scrollState, setScrollState] = useState<ScrollState>({ scrollTop: 0, scrollLeft: 0 });
  const [measuredHeights, setMeasuredHeights] = useState<Map<number, number>>(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());

  const isVertical = direction === "vertical";
  const scrollKey = isVertical ? "scrollTop" : "scrollLeft";
  const sizeKey = isVertical ? "height" : "width";
  const offsetKey = isVertical ? "top" : "left";

  // Calculate item metadata (offsets and sizes)
  const itemMetadata = useMemo(() => {
    const metadata: ItemMetadata[] = [];
    let offset = 0;

    for (let i = 0; i < items.length; i++) {
      let size: number;

      if (typeof itemHeight === "function") {
        // Use measured height if available, otherwise estimate
        const item = items[i];
        if (!item) continue;
        size = measuredHeights.get(i) ?? itemHeight(i, item);
      } else {
        size = measuredHeights.get(i) ?? itemHeight;
      }

      metadata[i] = { offset, size };
      offset += size;
    }

    return metadata;
  }, [items, itemHeight, measuredHeights]);

  // Calculate total size of all items
  const totalSize = useMemo(() => {
    if (itemMetadata.length === 0) return 0;
    const lastItem = itemMetadata[itemMetadata.length - 1];
    if (!lastItem) return 0;
    return lastItem.offset + lastItem.size;
  }, [itemMetadata]);

  // Calculate which items are visible
  const visibleRange = useMemo(() => {
    if (items.length === 0) {
      return { start: 0, end: 0 };
    }

    const scrollOffset = scrollState[scrollKey];
    const containerSize = isVertical
      ? height
      : typeof width === "number"
        ? width
        : (containerRef.current?.clientWidth ?? 0);

    // Binary search for start index
    let start = 0;
    let end = items.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const item = itemMetadata[mid];

      if (!item) break;

      if (item.offset <= scrollOffset) {
        start = mid + 1;
      } else {
        end = mid - 1;
      }
    }

    const startIndex = Math.max(0, end - overscan);

    // Find end index
    const visibleEnd = scrollOffset + containerSize;
    let endIndex = startIndex;

    while (endIndex < items.length) {
      const metadata = itemMetadata[endIndex];
      if (!metadata || metadata.offset >= visibleEnd) break;
      endIndex++;
    }

    endIndex = Math.min(items.length, endIndex + overscan);

    return { start: startIndex, end: endIndex };
  }, [items.length, itemMetadata, scrollState, scrollKey, height, width, overscan, isVertical]);

  // Get visible items
  const visibleItems = useMemo(() => {
    return items.slice(visibleRange.start, visibleRange.end).map((item, index) => ({
      item,
      index: visibleRange.start + index,
    }));
  }, [items, visibleRange]);

  // Handle scroll events
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollLeft } = e.currentTarget;

      startTransition(() => {
        setScrollState({ scrollTop, scrollLeft });
        onScroll?.(scrollTop, scrollLeft);

        // Trigger infinite scroll if near the end
        if (hasNextPage && !isLoading && onLoadMore) {
          const { scrollHeight, clientHeight } = e.currentTarget;
          const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

          if (scrollPercentage > 0.9) {
            onLoadMore();
          }
        }
      });
    },
    [hasNextPage, isLoading, onLoadMore, onScroll]
  );

  // Set up ResizeObserver to measure dynamic heights
  useEffect(() => {
    if (typeof itemHeight !== "function") return;

    resizeObserverRef.current = new ResizeObserver((entries) => {
      const newMeasurements = new Map(measuredHeights);
      let hasChanges = false;

      entries.forEach((entry) => {
        const element = entry.target as HTMLElement;
        const index = Number(element.getAttribute("data-index"));

        if (!isNaN(index)) {
          const newSize = isVertical ? entry.contentRect.height : entry.contentRect.width;
          const currentSize = newMeasurements.get(index);

          if (currentSize !== newSize) {
            newMeasurements.set(index, newSize);
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        setMeasuredHeights(newMeasurements);
      }
    });

    // Observe all currently rendered items
    itemRefs.current.forEach((element) => {
      resizeObserverRef.current!.observe(element);
    });

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [itemHeight, measuredHeights, isVertical]);

  // Handle scrollToIndex
  useEffect(() => {
    if (scrollToIndex !== undefined && scrollElementRef.current && itemMetadata[scrollToIndex]) {
      const targetOffset = itemMetadata[scrollToIndex].offset;

      if (isVertical) {
        scrollElementRef.current.scrollTop = targetOffset;
      } else {
        scrollElementRef.current.scrollLeft = targetOffset;
      }
    }
  }, [scrollToIndex, itemMetadata, isVertical]);

  // Ref callback for rendered items
  const setItemRef = useCallback(
    (index: number) => (element: HTMLElement | null) => {
      if (element) {
        itemRefs.current.set(index, element);
        if (resizeObserverRef.current && typeof itemHeight === "function") {
          resizeObserverRef.current.observe(element);
        }
      } else {
        const existingElement = itemRefs.current.get(index);
        if (existingElement && resizeObserverRef.current) {
          resizeObserverRef.current.unobserve(existingElement);
        }
        itemRefs.current.delete(index);
      }
    },
    [itemHeight]
  );

  // Render empty state
  if (items.length === 0 && !isLoading) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height, width }}>
        {EmptyComponent ? (
          <EmptyComponent />
        ) : (
          <div className="text-gray-500 text-center">
            <p>No items to display</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto ${className}`}
      style={{ height, width }}
      onScroll={handleScroll}
    >
      <div
        ref={scrollElementRef}
        style={{
          [sizeKey]: totalSize,
          position: "relative",
        }}
      >
        {/* Render visible items */}
        {visibleItems.map(({ item, index }) => {
          const metadata = itemMetadata[index];
          if (!metadata) return null;

          const style: React.CSSProperties = {
            position: "absolute",
            [offsetKey]: metadata.offset,
            [sizeKey]: metadata.size,
            width: isVertical ? "100%" : metadata.size,
            height: isVertical ? metadata.size : "100%",
          };

          return (
            <div key={index} data-index={index} ref={setItemRef(index)} style={style}>
              {renderItem(item, index, style)}
            </div>
          );
        })}

        {/* Loading indicator */}
        {isLoading && (
          <div
            className="absolute inset-x-0 flex items-center justify-center p-4"
            style={{
              [offsetKey]: totalSize,
              [sizeKey]: 60,
            }}
          >
            {LoadingComponent ? (
              <LoadingComponent />
            ) : (
              <div className="flex items-center space-x-2 text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span>Loading more items...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Performance indicator when pending */}
      {isPending && (
        <div className="absolute top-2 right-2 bg-blue-100 text-blue-600 px-2 py-1 rounded-sm text-xs">
          Updating...
        </div>
      )}
    </div>
  );
}

// HOC for memoized item rendering to prevent unnecessary re-renders
export function memo<T>(
  component: React.ComponentType<{ item: T; index: number; style: React.CSSProperties }>
): React.ComponentType<{ item: T; index: number; style: React.CSSProperties }> {
  return React.memo(component, (prevProps, nextProps) => {
    return (
      prevProps.index === nextProps.index &&
      prevProps.item === nextProps.item &&
      JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style)
    );
  });
}

// Custom hook for virtual scrolling with external data fetching
export function useVirtualScroll<T>({
  fetchData,
  pageSize = 50,
  initialData = [],
}: {
  fetchData: (page: number, size: number) => Promise<{ items: T[]; hasMore: boolean }>;
  pageSize?: number;
  initialData?: T[];
}) {
  const [items, setItems] = useState<T[]>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasNextPage) return;

    setIsLoading(true);

    try {
      const result = await fetchData(currentPage + 1, pageSize);

      startTransition(() => {
        setItems((prev) => [...prev, ...result.items]);
        setHasNextPage(result.hasMore);
        setCurrentPage((prev) => prev + 1);
      });
    } catch (error) {
      virtualScrollListLogger.error("Failed to load more items", error as Error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchData, pageSize, currentPage, isLoading, hasNextPage]);

  const reset = useCallback(() => {
    setItems(initialData);
    setCurrentPage(0);
    setHasNextPage(true);
    setIsLoading(false);
  }, [initialData]);

  return {
    items,
    isLoading,
    hasNextPage,
    loadMore,
    reset,
  };
}
