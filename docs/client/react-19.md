# React 19 Concurrent Features Implementation Guide

## Overview

React 19 introduces powerful concurrent rendering capabilities that significantly improve user experience by enabling non-blocking UI updates, better resource utilization, and enhanced performance. This guide details how React 19's concurrent features are implemented throughout our Phase 2 architecture.

## Core Concurrent Features

### 1. Automatic Batching

React 19 automatically batches state updates, reducing unnecessary re-renders and improving performance.

**Location**: `apps/client/lib/hooks/useAutoSave.ts`

```typescript
import { useState, useEffect, useTransition, useMemo } from "react";
import { useDeferredValue } from "react";

interface AutoSaveOptions {
  delay: number;
  onSave: (data: any) => Promise<void>;
  onError?: (error: Error) => void;
  optimisticUpdates?: boolean;
}

export function useAutoSave<T>(initialData: T, options: AutoSaveOptions) {
  const [data, setData] = useState(initialData);
  const [lastSaved, setLastSaved] = useState<T>(initialData);
  const [isPending, startTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Defer expensive operations during typing
  const deferredData = useDeferredValue(data);

  // Check if data has changed (using React 19's automatic batching)
  const hasChanges = useMemo(() => {
    return JSON.stringify(data) !== JSON.stringify(lastSaved);
  }, [data, lastSaved]);

  // Auto-save with concurrent features
  useEffect(() => {
    if (!hasChanges || isSaving) return;

    const timeoutId = setTimeout(() => {
      // Use transition for non-urgent save operation
      startTransition(async () => {
        try {
          setIsSaving(true);
          setError(null);

          // Perform save operation
          await options.onSave(deferredData);

          // Update last saved state (batched with concurrent features)
          setLastSaved(deferredData);
          setIsSaving(false);
        } catch (error) {
          const saveError = error instanceof Error ? error : new Error("Save failed");
          setError(saveError);
          setIsSaving(false);
          options.onError?.(saveError);
        }
      });
    }, options.delay);

    return () => clearTimeout(timeoutId);
  }, [deferredData, hasChanges, isSaving, options]);

  return {
    data,
    setData,
    hasChanges,
    isSaving: isSaving || isPending,
    error,
    lastSaved,
  };
}
```

### 2. Suspense Boundaries for Data Fetching

**Location**: `apps/client/components/posts/PostsList.tsx`

```typescript
import { Suspense, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

interface PostsListProps {
  projectId: string;
  filters?: PostFilters;
}

export function PostsList({ projectId, filters }: PostsListProps) {
  // Memoize filter configuration to prevent unnecessary suspensions
  const memoizedFilters = useMemo(() => filters, [filters]);

  return (
    <ErrorBoundary
      fallback={<PostsErrorFallback />}
      onError={(error, errorInfo) => {
        console.error('Posts list error:', error, errorInfo);
        // Report to error tracking service
      }}
    >
      <Suspense fallback={<PostsListSkeleton />}>
        <PostsListContent
          projectId={projectId}
          filters={memoizedFilters}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

// Suspense-compatible data fetching component
function PostsListContent({ projectId, filters }: PostsListProps) {
  // This hook suspends until data is loaded
  const posts = usePosts(projectId, filters);

  return (
    <div className="posts-list">
      {posts.map((post) => (
        <Suspense key={post.id} fallback={<PostCardSkeleton />}>
          <PostCard post={post} />
        </Suspense>
      ))}
    </div>
  );
}

// Skeleton components for loading states
function PostsListSkeleton() {
  return (
    <div className="posts-list-skeleton">
      {Array.from({ length: 6 }, (_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  );
}

function PostCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="bg-gray-300 h-4 mb-2 rounded"></div>
      <div className="bg-gray-300 h-3 mb-2 w-3/4 rounded"></div>
      <div className="bg-gray-300 h-3 w-1/2 rounded"></div>
    </div>
  );
}
```

### 3. Concurrent Rendering with useTransition

**Location**: `apps/client/app/dashboard/posts/page.tsx`

```typescript
import { useState, useTransition, useDeferredValue, useCallback } from 'react';
import { PostsList } from '../../../components/posts/PostsList';

export default function PostsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<PostFilters>({});
  const [isPending, startTransition] = useTransition();

  // Defer search term to prevent blocking UI during typing
  const deferredSearchTerm = useDeferredValue(searchTerm);

  // Handle search with concurrent rendering
  const handleSearch = useCallback((term: string) => {
    // Update search immediately for UI responsiveness
    setSearchTerm(term);

    // Update filters in a transition (non-urgent)
    startTransition(() => {
      setFilters(prevFilters => ({
        ...prevFilters,
        search: term
      }));
    });
  }, []);

  // Handle filter changes with transitions
  const handleFilterChange = useCallback((newFilters: Partial<PostFilters>) => {
    startTransition(() => {
      setFilters(prevFilters => ({
        ...prevFilters,
        ...newFilters
      }));
    });
  }, []);

  return (
    <div className="posts-page">
      <div className="posts-header">
        <SearchInput
          value={searchTerm}
          onChange={handleSearch}
          placeholder="Search posts..."
          isPending={isPending}
        />

        <FilterControls
          filters={filters}
          onChange={handleFilterChange}
          isPending={isPending}
        />
      </div>

      {/* Show loading indicator during transitions */}
      {isPending && (
        <div className="transition-indicator">
          <span>Updating results...</span>
        </div>
      )}

      <Suspense fallback={<PostsListSkeleton />}>
        <PostsList
          projectId={projectId}
          filters={{ ...filters, search: deferredSearchTerm }}
        />
      </Suspense>
    </div>
  );
}

// Enhanced search input with concurrent features
function SearchInput({ value, onChange, placeholder, isPending }) {
  const [localValue, setLocalValue] = useState(value);

  // Update local state immediately, debounce the callback
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    // Debounce the parent callback
    const timeoutId = setTimeout(() => {
      onChange(newValue);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [onChange]);

  return (
    <div className="relative">
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className={`search-input ${isPending ? 'opacity-75' : ''}`}
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
          <LoadingSpinner size="sm" />
        </div>
      )}
    </div>
  );
}
```

### 4. Server Components Integration

**Location**: `apps/client/components/dashboard/ServerStatsCard.tsx`

```typescript
import { Suspense } from 'react';

// Server Component for fetching data at build time
async function ServerStatsCard() {
  // This runs on the server
  const stats = await fetchDashboardStats();

  return (
    <div className="stats-card">
      <h3>Dashboard Statistics</h3>
      <div className="stats-grid">
        <StatItem
          label="Total Posts"
          value={stats.totalPosts}
          trend={stats.postsTrend}
        />
        <StatItem
          label="Published"
          value={stats.publishedPosts}
          trend={stats.publishedTrend}
        />
        <StatItem
          label="Engagement"
          value={stats.totalEngagement}
          trend={stats.engagementTrend}
        />
      </div>
    </div>
  );
}

// Client Component for interactive features
function StatItem({ label, value, trend }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="stat-item"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="stat-main">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>

      {trend && (
        <div className={`stat-trend ${trend.direction}`}>
          <span>{trend.percentage}%</span>
          <TrendIcon direction={trend.direction} />
        </div>
      )}

      {isExpanded && (
        <Suspense fallback={<DetailsSkeleton />}>
          <StatDetails label={label} />
        </Suspense>
      )}
    </div>
  );
}

// Export with Suspense wrapper
export function DashboardStats() {
  return (
    <Suspense fallback={<StatsCardSkeleton />}>
      <ServerStatsCard />
    </Suspense>
  );
}
```

## Performance Monitoring System

**Location**: `apps/client/lib/performance/SystemMonitor.ts`

```typescript
import { startTransition } from 'react';

interface PerformanceMetrics {
  renderTime: number;
  interactionDelay: number;
  memoryUsage: number;
  cacheHitRate: number;
  errorRate: number;
}

interface VitalMetrics {
  LCP: number; // Largest Contentful Paint
  FID: number; // First Input Delay
  CLS: number; // Cumulative Layout Shift
  TTFB: number; // Time to First Byte
}

export class SystemMonitor {
  private metrics: PerformanceMetrics[] = [];
  private vitals: VitalMetrics | null = null;
  private observers: PerformanceObserver[] = [];

  constructor() {
    this.initializeMonitoring();
  }

  private initializeMonitoring(): void {
    // Monitor React concurrent features
    this.monitorConcurrentRendering();

    // Monitor Core Web Vitals
    this.monitorWebVitals();

    // Monitor resource usage
    this.monitorResourceUsage();

    // Monitor user interactions
    this.monitorUserInteractions();
  }

  private monitorConcurrentRendering(): void {
    // Monitor transition performance
    const transitionObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.name === 'react-transition') {
          this.recordTransitionMetric({
            duration: entry.duration,
            startTime: entry.startTime,
            type: entry.entryType
          });
        }
      });
    });

    transitionObserver.observe({ entryTypes: ['mark', 'measure'] });
    this.observers.push(transitionObserver);
  }

  private monitorWebVitals(): void {
    // Largest Contentful Paint
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];

      startTransition(() => {
        this.vitals = {
          ...this.vitals,
          LCP: lastEntry.startTime
        } as VitalMetrics;
      });
    });

    lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
    this.observers.push(lcpObserver);

    // First Input Delay
    const fidObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        startTransition(() => {
          this.vitals = {
            ...this.vitals,
            FID: entry.processingStart - entry.startTime
          } as VitalMetrics;
        });
      });
    });

    fidObserver.observe({ entryTypes: ['first-input'] });
    this.observers.push(fidObserver);

    // Cumulative Layout Shift
    const clsObserver = new PerformanceObserver((list) => {
      let clsValue = 0;

      list.getEntries().forEach((entry) => {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value;
        }
      });

      startTransition(() => {
        this.vitals = {
          ...this.vitals,
          CLS: clsValue
        } as VitalMetrics;
      });
    });

    clsObserver.observe({ entryTypes: ['layout-shift'] });
    this.observers.push(clsObserver);
  }

  private monitorResourceUsage(): void {
    // Monitor memory usage
    if ('memory' in performance) {
      setInterval(() => {
        const memory = (performance as any).memory;

        startTransition(() => {
          this.recordResourceMetric({
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            timestamp: Date.now()
          });
        });
      }, 5000);
    }

    // Monitor network performance
    const navigationObserver = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const navEntry = entry as PerformanceNavigationTiming;

        startTransition(() => {
          this.vitals = {
            ...this.vitals,
            TTFB: navEntry.responseStart - navEntry.requestStart
          } as VitalMetrics;
        });
      });
    });

    navigationObserver.observe({ entryTypes: ['navigation'] });
    this.observers.push(navigationObserver);
  }

  private monitorUserInteractions(): void {
    // Monitor interaction responsiveness
    let interactionStart: number | null = null;

    document.addEventListener('pointerdown', () => {
      interactionStart = performance.now();
    }, { passive: true });

    document.addEventListener('pointerup', () => {
      if (interactionStart) {
        const interactionDelay = performance.now() - interactionStart;

        startTransition(() => {
          this.recordInteractionMetric({
            delay: interactionDelay,
            timestamp: Date.now(),
            type: 'pointer'
          });
        });

        interactionStart = null;
      }
    }, { passive: true });

    // Monitor keyboard interactions
    document.addEventListener('keydown', () => {
      interactionStart = performance.now();
    }, { passive: true });

    document.addEventListener('keyup', () => {
      if (interactionStart) {
        const interactionDelay = performance.now() - interactionStart;

        startTransition(() => {
          this.recordInteractionMetric({
            delay: interactionDelay,
            timestamp: Date.now(),
            type: 'keyboard'
          });
        });

        interactionStart = null;
      }
    }, { passive: true });
  }

  // Get current performance metrics
  getMetrics(): PerformanceReport {
    const currentMetrics = this.metrics[this.metrics.length - 1];

    return {
      vitals: this.vitals,
      current: currentMetrics,
      trends: this.calculateTrends(),
      recommendations: this.generateRecommendations(),
      score: this.calculatePerformanceScore()
    };
  }

  // Calculate performance trends
  private calculateTrends(): PerformanceTrends {
    if (this.metrics.length < 2) {
      return {
        renderTime: 0,
        interactionDelay: 0,
        memoryUsage: 0
      };
    }

    const recent = this.metrics.slice(-10);
    const previous = this.metrics.slice(-20, -10);

    return {
      renderTime: this.calculateTrend(
        recent.map(m => m.renderTime),
        previous.map(m => m.renderTime)
      ),
      interactionDelay: this.calculateTrend(
        recent.map(m => m.interactionDelay),
        previous.map(m => m.interactionDelay)
      ),
      memoryUsage: this.calculateTrend(
        recent.map(m => m.memoryUsage),
        previous.map(m => m.memoryUsage)
      )
    };
  }

  // Generate performance recommendations
  private generateRecommendations(): PerformanceRecommendation[] {
    const recommendations: PerformanceRecommendation[] = [];

    if (this.vitals?.LCP && this.vitals.LCP > 2500) {
      recommendations.push({
        type: 'LCP_OPTIMIZATION',
        priority: 'HIGH',
        message: 'Largest Contentful Paint is above 2.5s. Consider optimizing images and critical resources.',
        action: 'Implement image optimization and preload critical resources'
      });
    }

    if (this.vitals?.FID && this.vitals.FID > 100) {
      recommendations.push({
        type: 'FID_OPTIMIZATION',
        priority: 'HIGH',
        message: 'First Input Delay is above 100ms. Consider reducing JavaScript execution time.',
        action: 'Use React.memo, useMemo, and useCallback to optimize re-renders'
      });
    }

    if (this.vitals?.CLS && this.vitals.CLS > 0.1) {
      recommendations.push({
        type: 'CLS_OPTIMIZATION',
        priority: 'MEDIUM',
        message: 'Cumulative Layout Shift is above 0.1. Stabilize layout during loading.',
        action: 'Set explicit dimensions for images and reserve space for dynamic content'
      });
    }

    return recommendations;
  }

  // Calculate overall performance score
  private calculatePerformanceScore(): number {
    if (!this.vitals) return 0;

    const scores = {
      LCP: this.scoreMetric(this.vitals.LCP, [2500, 4000]),
      FID: this.scoreMetric(this.vitals.FID, [100, 300]),
      CLS: this.scoreMetric(this.vitals.CLS, [0.1, 0.25])
    };

    return Math.round(
      (scores.LCP * 0.4 + scores.FID * 0.4 + scores.CLS * 0.2) * 100
    );
  }

  private scoreMetric(value: number, thresholds: [number, number]): number {
    const [good, poor] = thresholds;

    if (value <= good) return 1;
    if (value >= poor) return 0;

    return 1 - ((value - good) / (poor - good));
  }

  // Clean up observers
  cleanup(): void {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
  }
}

// Performance Context Provider
export function PerformanceProvider({ children }: { children: React.ReactNode }) {
  const [monitor] = useState(() => new SystemMonitor());

  useEffect(() => {
    return () => monitor.cleanup();
  }, [monitor]);

  return (
    <PerformanceContext.Provider value={monitor}>
      {children}
    </PerformanceContext.Provider>
  );
}

// Hook for accessing performance data
export function usePerformance() {
  const monitor = useContext(PerformanceContext);
  const [metrics, setMetrics] = useState<PerformanceReport | null>(null);

  useEffect(() => {
    const updateMetrics = () => {
      startTransition(() => {
        setMetrics(monitor.getMetrics());
      });
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 5000);

    return () => clearInterval(interval);
  }, [monitor]);

  return metrics;
}
```

## Optimized Error Boundaries

**Location**: `apps/client/components/ErrorBoundary.tsx`

```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { startTransition } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ComponentType<{ error: Error; retry: () => void }>;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isolate?: boolean; // Isolate errors from affecting parent components
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

export class ConcurrentErrorBoundary extends Component<Props, State> {
  private retryTimeoutId: number | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Use transition for non-urgent error handling
    startTransition(() => {
      this.setState({
        errorInfo
      });

      // Report error asynchronously
      this.props.onError?.(error, errorInfo);

      // Log to monitoring service
      console.error('React Error Boundary caught an error:', error, errorInfo);
    });
  }

  private handleRetry = () => {
    if (this.state.retryCount >= 3) {
      console.warn('Maximum retry attempts reached');
      return;
    }

    // Clear previous timeout
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }

    // Exponential backoff for retries
    const delay = Math.pow(2, this.state.retryCount) * 1000;

    this.retryTimeoutId = setTimeout(() => {
      startTransition(() => {
        this.setState({
          hasError: false,
          error: null,
          errorInfo: null,
          retryCount: this.state.retryCount + 1
        });
      });
    }, delay);
  };

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;

      return (
        <FallbackComponent
          error={this.state.error!}
          retry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

// Default error fallback with concurrent features
function DefaultErrorFallback({ error, retry }: { error: Error; retry: () => void }) {
  const [isRetrying, startRetryTransition] = useTransition();

  const handleRetry = () => {
    startRetryTransition(() => {
      retry();
    });
  };

  return (
    <div className="error-boundary-fallback">
      <h2>Something went wrong</h2>
      <details>
        <summary>Error details</summary>
        <pre>{error.message}</pre>
      </details>
      <button
        onClick={handleRetry}
        disabled={isRetrying}
        className="retry-button"
      >
        {isRetrying ? 'Retrying...' : 'Try Again'}
      </button>
    </div>
  );
}
```

## Integration with Next.js App Router

**Location**: `apps/client/app/layout.tsx`

```typescript
import { Suspense } from 'react';
import { PerformanceProvider } from '../lib/performance/SystemMonitor';
import { ConcurrentErrorBoundary } from '../components/ErrorBoundary';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PerformanceProvider>
          <ConcurrentErrorBoundary>
            <div id="root">
              <Suspense fallback={<GlobalLoadingFallback />}>
                <NavigationHeader />
              </Suspense>

              <main className="main-content">
                <ConcurrentErrorBoundary isolate>
                  {children}
                </ConcurrentErrorBoundary>
              </main>

              <Suspense fallback={<FooterSkeleton />}>
                <Footer />
              </Suspense>
            </div>
          </ConcurrentErrorBoundary>
        </PerformanceProvider>
      </body>
    </html>
  );
}

function GlobalLoadingFallback() {
  return (
    <div className="global-loading">
      <div className="loading-spinner" />
      <span>Loading application...</span>
    </div>
  );
}
```

## Best Practices

### 1. Transition Usage Guidelines

- Use transitions for non-urgent updates (filtering, sorting, navigation)
- Keep urgent updates (typing, clicking) outside transitions
- Prefer `startTransition` over `useTransition` for event handlers

### 2. Suspense Implementation

- Implement meaningful loading states with skeleton screens
- Use error boundaries alongside Suspense for robust error handling
- Avoid deeply nested Suspense boundaries

### 3. Performance Optimization

- Use `useMemo` and `useCallback` appropriately
- Implement code splitting with dynamic imports
- Monitor Core Web Vitals continuously
- Optimize bundle sizes and reduce JavaScript execution time

### 4. Memory Management

- Clean up resources in `useEffect` cleanup functions
- Monitor memory usage in production
- Use React DevTools Profiler to identify performance bottlenecks

This React 19 concurrent features implementation provides a solid foundation for building highly responsive and performant user interfaces while maintaining excellent developer experience and code maintainability.
