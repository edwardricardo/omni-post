/**
 * @file page.tsx
 * @description AI content generation page that renders the AIContentGenerator component for
 * producing optimized social media copy from configurable templates and settings.
 */
"use client";

import { AIContentGenerator } from "@/components/ai/AIContentGenerator";

export default function AIGeneratePage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Content Generation</h1>
        <p className="text-gray-600">Generate optimized content using AI templates</p>
      </div>
      <AIContentGenerator />
    </div>
  );
}
