"use client";

/**
 * @file AIGenerationPreview.tsx
 * @description Loading indicator shown while AI content generation is in progress,
 * providing animated feedback and step-by-step status messages to the user.
 */

import React from "react";
import { Brain } from "lucide-react";

export function AIGenerationPreview() {
  return (
    <div className="text-center py-12" role="status" aria-live="polite">
      <div className="inline-flex items-center space-x-3 mb-6">
        <Brain className="w-8 h-8 text-purple-600 animate-pulse" aria-hidden="true" />
        <div className="text-xl font-semibold text-gray-900">Generating your content...</div>
      </div>
      <div className="space-y-2 text-sm text-gray-600">
        <div>✨ Analyzing your template and variables</div>
        <div>🎯 Optimizing for each platform</div>
        <div>🧠 Applying AI creativity and brand consistency</div>
        <div>📊 Calculating engagement predictions</div>
      </div>
    </div>
  );
}
