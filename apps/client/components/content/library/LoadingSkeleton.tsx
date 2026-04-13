"use client";

/**
 * @file LoadingSkeleton.tsx
 * @description Skeleton loading placeholder for the content library that mimics the grid
 * layout while content items are being fetched from the API.
 */

import React from "react";

/**
 * @component LoadingSkeleton
 * @description Skeleton loading placeholder mimicking the content library grid layout
 * while items are being fetched from the API.
 */
export function LoadingSkeleton() {
  return (
    <div className="content-library p-6">
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded-sm w-1/4 mb-6"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-64 bg-gray-200 rounded-sm"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
