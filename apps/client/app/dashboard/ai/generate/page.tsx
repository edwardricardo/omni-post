/**
 * @file page.tsx
 * @description AI generation page with both content generation and image generation.
 */

"use client";

import { AIContentGenerator } from "@/components/ai/AIContentGenerator";
import { AIImageGenerator } from "@/components/ai/AIImageGenerator";
import { useState } from "react";

type Tab = "content" | "images";

export default function AIGeneratePage() {
  const [tab, setTab] = useState<Tab>("content");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Generation</h1>
        <p className="text-gray-600 text-sm mt-1">Generate optimized content and images using AI</p>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-gray-200 mb-6 gap-1">
        {(["content", "images"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-700",
            ].join(" ")}
          >
            {t === "content" ? "Content" : "Images"}
          </button>
        ))}
      </div>

      {tab === "content" && <AIContentGenerator />}
      {tab === "images" && <AIImageGenerator />}
    </div>
  );
}
