"use client";

/**
 * @file AIContentResults.tsx
 * @description Displays the list of AI-generated content variants with per-item copy,
 * save, and media-type indicators, plus a bulk "save all" and "new generation" action.
 */

import React from "react";
import { Copy, Save, Camera, Video } from "lucide-react";
import type { GeneratedContent } from "../../types/ai-content";
import { getCharacterLimitColor } from "../../lib/ai-content-utils";

interface AIContentResultsProps {
  content: GeneratedContent[];
  onCopy: (text: string) => void;
  onSave?: (content: GeneratedContent) => void;
  onSaveAll?: () => void;
  onNewGeneration: () => void;
}

/**
 * @component AIContentResults
 * @description Displays AI-generated content variants with per-item copy, save, and
 * media-type indicators, plus bulk save-all and new-generation actions.
 * @param props.onSave - Callback to persist a single generated content variant
 * @param props.onNewGeneration - Resets the flow to generate fresh content
 */
export function AIContentResults({
  content,
  onCopy,
  onSave,
  onSaveAll,
  onNewGeneration,
}: AIContentResultsProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">Generated Content</h4>
        <div className="flex space-x-2">
          <button
            onClick={onNewGeneration}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            New Generation
          </button>
          {onSaveAll && (
            <button
              onClick={onSaveAll}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>Save All</span>
            </button>
          )}
        </div>
      </div>

      {/* Content Cards */}
      <div className="grid gap-6">
        {content.map((item) => (
          <div key={item.id} className="border rounded-lg p-6">
            {/* Platform Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h5 className="font-semibold text-gray-900 capitalize">{item.platform}</h5>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => onCopy(item.content.text)}
                  className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-sm"
                  title="Copy to clipboard"
                  aria-label="Copy content to clipboard"
                >
                  <Copy className="w-4 h-4" />
                </button>
                {onSave && (
                  <button
                    onClick={() => onSave(item)}
                    className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 rounded-sm"
                    title="Save content"
                    aria-label="Save this content"
                  >
                    <Save className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Content Text */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="whitespace-pre-wrap text-gray-900">{item.content.text}</div>
              {item.content.hashtags.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="flex flex-wrap gap-1">
                    {item.content.hashtags.map((hashtag, idx) => (
                      <span key={idx} className="text-blue-600 text-sm">
                        #{hashtag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div
                  className={`font-semibold ${getCharacterLimitColor(item.metrics.characterCount, item.platform)}`}
                >
                  {item.metrics.characterCount}
                </div>
                <div className="text-xs text-gray-600">Characters</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-900">{item.metrics.wordCount}</div>
                <div className="text-xs text-gray-600">Words</div>
              </div>
              <div className="text-center">
                <div className="font-semibold text-gray-900">{item.metrics.hashtagCount}</div>
                <div className="text-xs text-gray-600">Hashtags</div>
              </div>
            </div>

            {/* Media Suggestions */}
            {item.content.media && item.content.media.length > 0 && (
              <div className="mb-4">
                <h6 className="font-medium text-gray-900 mb-2">Media Suggestions</h6>
                <div className="space-y-2">
                  {item.content.media.map((media, idx) => (
                    <div
                      key={idx}
                      className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg"
                    >
                      {media.type === "image" ? (
                        <Camera className="w-5 h-5 text-blue-600" aria-hidden="true" />
                      ) : (
                        <Video className="w-5 h-5 text-blue-600" aria-hidden="true" />
                      )}
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{media.suggestion}</div>
                        <div className="text-xs text-gray-600">Recommended: {media.dimensions}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Variations */}
            {item.variations.length > 0 && (
              <div className="border-t pt-4">
                <h6 className="font-medium text-gray-900 mb-3">Alternative Versions</h6>
                <div className="space-y-3">
                  {item.variations.map((variation) => (
                    <div key={variation.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex space-x-2">
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-sm">
                            {variation.tone}
                          </span>
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-sm">
                            {variation.targetAudience}
                          </span>
                        </div>
                        <button
                          onClick={() => onCopy(variation.text)}
                          className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-sm"
                          aria-label={`Copy ${variation.tone} variation`}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-sm text-gray-900">{variation.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
