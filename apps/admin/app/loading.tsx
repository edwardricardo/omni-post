/**
 * @file loading.tsx
 * @description Next.js root loading UI rendered as a skeleton screen while dashboard pages
 * are streaming their data, providing animated placeholders for header, stats cards, and charts.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Skeleton */}
        <div className="mb-8 animate-pulse">
          <div className="h-10 bg-gray-200 rounded-sm w-64 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded-sm w-96"></div>
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded-sm w-24 mb-3"></div>
              <div className="h-8 bg-gray-200 rounded-sm w-16 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded-sm w-20"></div>
            </div>
          ))}
        </div>

        {/* Charts Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded-sm w-48 mb-4"></div>
              <div className="h-64 bg-gray-200 rounded-sm"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
