/**
 * @file loading.tsx
 * @description Next.js root loading UI rendered as a skeleton screen while dashboard pages
 * are streaming their data, providing animated placeholders for header, stats cards, and charts.
 * @component Loading
 * @layer infrastructure
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Skeleton */}
        <div className="mb-8 animate-pulse">
          <div className="h-10 bg-[var(--bg-elevated)] rounded-sm w-64 mb-2" />
          <div className="h-4 bg-[var(--bg-elevated)] rounded-sm w-96" />
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] p-6 animate-pulse"
            >
              <div className="h-4 bg-[var(--bg-elevated)] rounded-sm w-24 mb-3" />
              <div className="h-8 bg-[var(--bg-elevated)] rounded-sm w-16 mb-2" />
              <div className="h-3 bg-[var(--bg-elevated)] rounded-sm w-20" />
            </div>
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] p-6 animate-pulse"
            >
              <div className="h-6 bg-[var(--bg-elevated)] rounded-sm w-48 mb-4" />
              <div className="h-64 bg-[var(--bg-elevated)] rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
