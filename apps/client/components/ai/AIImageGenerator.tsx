/**
 * @file AIImageGenerator.tsx
 * @description AI image generation form and gallery. Uses OpenAI image generation
 *              via the backend API. Shows a prompt form, generated image preview,
 *              and a gallery of previously generated images.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { Sparkles, Download, Copy, CheckCircle } from "lucide-react";
import { useGenerateImage, useGeneratedImages } from "@/hooks/api/useAIImages";
import type { ImageSize, ImageQuality, ImageStyle } from "@/hooks/api/useAIImages";
import { useProject } from "@/providers/ProjectProvider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIZES: { label: string; value: ImageSize }[] = [
  { label: "Square (1024×1024)", value: "1024x1024" },
  { label: "Portrait (1024×1792)", value: "1024x1792" },
  { label: "Landscape (1792×1024)", value: "1792x1024" },
];

const QUALITIES: { label: string; value: ImageQuality }[] = [
  { label: "Standard", value: "standard" },
  { label: "HD", value: "hd" },
];

const STYLES: { label: string; value: ImageStyle }[] = [
  { label: "Natural", value: "natural" },
  { label: "Vivid", value: "vivid" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @component AIImageGenerator
 * @description AI-powered image generation interface using OpenAI image generation via the
 * backend API, with a prompt form, size/quality/style selectors, preview, and gallery.
 */

export function AIImageGenerator() {
  const { projectId } = useProject();

  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>("1024x1024");
  const [quality, setQuality] = useState<ImageQuality>("standard");
  const [style, setStyle] = useState<ImageStyle>("natural");
  const [copied, setCopied] = useState<string | null>(null);

  const generateMutation = useGenerateImage(projectId);
  const { data: gallery = [], isLoading: galleryLoading } = useGeneratedImages(projectId);

  const latestImage = generateMutation.data;

  const handleGenerate = useCallback(() => {
    if (prompt.trim().length < 10) return;
    generateMutation.mutate({ projectId, prompt: prompt.trim(), size, quality, style });
  }, [prompt, size, quality, style, projectId, generateMutation]);

  const handleCopy = useCallback(async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  return (
    <div className="space-y-8">
      {/* Form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Generate Image</h2>

        <div className="space-y-4">
          {/* Prompt */}
          <div>
            <label htmlFor="ai-prompt" className="block text-sm font-medium text-gray-700 mb-1">
              Prompt
            </label>
            <textarea
              id="ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want to generate (min. 10 characters)…"
              rows={3}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Options row */}
          <div className="flex flex-wrap gap-4">
            {/* Size */}
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="ai-size" className="block text-xs font-medium text-gray-600 mb-1">
                Size
              </label>
              <select
                id="ai-size"
                value={size}
                onChange={(e) => setSize(e.target.value as ImageSize)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Quality */}
            <div className="flex-1 min-w-[140px]">
              <label htmlFor="ai-quality" className="block text-xs font-medium text-gray-600 mb-1">
                Quality
              </label>
              <select
                id="ai-quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value as ImageQuality)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Style */}
            <div className="flex-1 min-w-[140px]">
              <label htmlFor="ai-style" className="block text-xs font-medium text-gray-600 mb-1">
                Style
              </label>
              <select
                id="ai-style"
                value={style}
                onChange={(e) => setStyle(e.target.value as ImageStyle)}
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {STYLES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={prompt.trim().length < 10 || generateMutation.isPending}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {generateMutation.isPending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Generating image…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Generate
              </>
            )}
          </button>

          {generateMutation.isError && (
            <p className="text-sm text-red-600">{generateMutation.error?.message}</p>
          )}
        </div>

        {/* Latest generated image */}
        {latestImage && (
          <div className="mt-6 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Generated Image
            </p>
            <img
              src={latestImage.url}
              alt={latestImage.prompt}
              className="max-w-[400px] w-full rounded-lg border border-gray-200 shadow-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void handleCopy(latestImage.url)}
                className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied === latestImage.url ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied === latestImage.url ? "Copied!" : "Copy URL"}
              </button>
              <a
                href={latestImage.url}
                download
                className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Gallery */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Generated Images</h2>

        {galleryLoading && (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="aspect-square rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {!galleryLoading && gallery.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center">
            <p className="text-sm text-gray-500">No images generated yet.</p>
            <p className="text-xs text-gray-400 mt-1">Try the form above!</p>
          </div>
        )}

        {!galleryLoading && gallery.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {gallery.map((img) => (
              <div key={img.id} className="group relative aspect-square">
                <img
                  src={img.url}
                  alt={img.prompt}
                  loading="lazy"
                  className="h-full w-full rounded-lg object-cover border border-gray-200"
                  title={img.prompt}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => void handleCopy(img.url)}
                    className="rounded-md bg-white/90 p-1.5 text-gray-800 hover:bg-white"
                    aria-label="Copy URL"
                  >
                    {copied === img.url ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <a
                    href={img.url}
                    download
                    className="rounded-md bg-white/90 p-1.5 text-gray-800 hover:bg-white"
                    aria-label="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
