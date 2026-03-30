"use client";

/**
 * @file TemplatesLoadingSkeleton.tsx
 * @description Skeleton loading placeholder for the templates section displayed while
 * template and automation data is being fetched from the API.
 */

import React from "react";

export const TemplatesLoadingSkeleton: React.FC = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Content Templates</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-4">
            <div className="animate-pulse space-y-3">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gray-300 rounded-lg"></div>
                <div className="h-4 bg-gray-300 rounded-sm w-32"></div>
              </div>
              <div className="h-4 bg-gray-300 rounded-sm w-full"></div>
              <div className="h-16 bg-gray-300 rounded-sm"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
