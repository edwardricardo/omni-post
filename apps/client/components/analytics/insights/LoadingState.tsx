"use client";

/**
 * @file LoadingState.tsx
 * @description Skeleton placeholder rendered while performance insight data
 * is being fetched or analysed, using animated pulse blocks to indicate loading.
 */

import React from "react";

/**
 * @component LoadingState
 * @description Skeleton placeholder rendered while performance insight data is being
 * fetched, using animated pulse blocks to indicate loading.
 */
export function LoadingState() {
  return (
    <div className="performance-insights p-6">
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded-sm w-1/3 mb-6"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-sm"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
