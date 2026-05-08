"use client";

/**
 * @file AIGenerationPreview.tsx
 * @description Loading indicator shown while AI content generation is in progress.
 *              Simple spinner with a single status message — no fabricated progress
 *              steps, since the backend does not stream per-step progress today.
 * @layer infrastructure
 */

import React from "react";
import { Brain } from "lucide-react";

/**
 * @component AIGenerationPreview
 * @description Loading indicator shown while AI content generation is in progress.
 */
export function AIGenerationPreview() {
  return (
    <div className="text-center py-12" role="status" aria-live="polite">
      <div className="inline-flex items-center space-x-3 mb-4">
        <Brain className="w-8 h-8 text-purple-600 animate-pulse" aria-hidden="true" />
        <div className="text-xl font-semibold text-gray-900">Generating your content…</div>
      </div>
      <p className="text-sm text-gray-600">This usually takes a few seconds.</p>
    </div>
  );
}
