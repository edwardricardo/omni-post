/**
 * @file LoadingState.tsx
 * @description Animated skeleton screen displayed while predictive analytics data
 * is being fetched from the backend AI and analytics endpoints.
 */

import React from "react";
import { Brain } from "lucide-react";

export const LoadingState: React.FC = () => {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-center space-x-3 py-8">
        <Brain className="w-6 h-6 text-purple-600 animate-pulse" />
        <div className="text-lg font-medium text-gray-900">Analyzing performance patterns...</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="h-4 bg-gray-300 rounded-sm w-3/4 mb-2"></div>
            <div className="h-8 bg-gray-300 rounded-sm"></div>
          </div>
        ))}
      </div>
    </div>
  );
};
