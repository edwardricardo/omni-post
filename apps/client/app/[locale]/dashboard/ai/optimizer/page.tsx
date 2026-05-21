/**
 * @file page.tsx
 * @description Smart content optimizer page with a text input area and the SmartContentOptimizer
 * component that provides real-time content analysis and optimization suggestions.
 */
"use client";

import { useState } from "react";
import SmartContentOptimizer from "@/components/ai/SmartContentOptimizer";
/**
 * @component SmartOptimizerPage
 * @description Displays a content input area with real-time AI analysis and optimization suggestions for social media posts.
 */
export default function SmartOptimizerPage() {
  const [content, setContent] = useState("");

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Smart Content Optimizer</h1>
        <p className="text-gray-600">
          Content analysis and optimization for your social media posts
        </p>
      </div>

      {/* Content input — the optimizer component needs content passed as a prop */}
      <div className="mb-6">
        <label htmlFor="content-input" className="block text-sm font-medium text-gray-700 mb-2">
          Your content
        </label>
        <textarea
          id="content-input"
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste or type your social media content here to get optimization suggestions..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-xs focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
        />
      </div>

      <SmartContentOptimizer
        content={content}
        platforms={["twitter", "linkedin", "facebook", "instagram"]}
        realTimeAnalysis={true}
        showAdvancedMetrics={false}
      />
    </div>
  );
}
