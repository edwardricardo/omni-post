/**
 * @file PostsLoadingSkeleton.tsx
 * @description Six-tile pulse skeleton matching the posts grid layout.
 *              Shared between the Suspense fallback and the imperative
 *              `isLoading` branch.
 * @component PostsLoadingSkeleton
 * @layer infrastructure
 */

import { Card, CardContent, CardHeader } from "@packages/ui";

export function PostsLoadingSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="animate-pulse">
          <CardHeader>
            <div className="h-4 bg-gray-200 rounded-sm w-3/4"></div>
            <div className="h-3 bg-gray-200 rounded-sm w-1/2"></div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 rounded-sm"></div>
              <div className="h-3 bg-gray-200 rounded-sm"></div>
              <div className="h-3 bg-gray-200 rounded-sm w-2/3"></div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
