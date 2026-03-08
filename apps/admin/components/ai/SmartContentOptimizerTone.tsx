"use client";

/**
 * @file SmartContentOptimizerTone.tsx
 * @description Tone analysis tab for the SmartContentOptimizer, displaying detected
 * tone, confidence score, emotional analysis bars, and tone recommendations.
 */

import React from "react";
import { MessageCircle } from "lucide-react";
import type { ToneAnalysis } from "./smartContentOptimizerUtils";

interface SmartContentOptimizerToneProps {
  toneAnalysis: ToneAnalysis;
}

export function SmartContentOptimizerTone({ toneAnalysis }: SmartContentOptimizerToneProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-semibold text-gray-900">Tone Analysis</h4>
        <div
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            toneAnalysis.confidence >= 80
              ? "bg-green-100 text-green-800"
              : toneAnalysis.confidence >= 60
                ? "bg-yellow-100 text-yellow-800"
                : "bg-red-100 text-red-800"
          }`}
        >
          {Math.round(toneAnalysis.confidence)}% confidence
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h5 className="font-semibold text-gray-900 mb-3">Detected Tone</h5>
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <MessageCircle className="w-5 h-5 text-blue-600" />
              <span className="text-lg font-semibold text-blue-900 capitalize">
                {toneAnalysis.detected}
              </span>
            </div>
            <p className="text-sm text-blue-700">
              Appropriate for: {toneAnalysis.appropriateFor.join(", ")}
            </p>
          </div>
        </div>

        <div>
          <h5 className="font-semibold text-gray-900 mb-3">Emotional Analysis</h5>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-600">Positive</span>
                <span className="text-sm font-medium">
                  {Math.round(toneAnalysis.emotionalTone.positive * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{ width: `${toneAnalysis.emotionalTone.positive * 100}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-600">Neutral</span>
                <span className="text-sm font-medium">
                  {Math.round(toneAnalysis.emotionalTone.neutral * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gray-500 h-2 rounded-full"
                  style={{ width: `${toneAnalysis.emotionalTone.neutral * 100}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-600">Negative</span>
                <span className="text-sm font-medium">
                  {Math.round(toneAnalysis.emotionalTone.negative * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-red-500 h-2 rounded-full"
                  style={{ width: `${toneAnalysis.emotionalTone.negative * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {toneAnalysis.suggestedTone && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h5 className="font-semibold text-amber-900 mb-2">Tone Recommendation</h5>
          <p className="text-amber-800">
            Consider adjusting to a more{" "}
            <span className="font-semibold">{toneAnalysis.suggestedTone}</span> tone for better
            alignment with your target audience and platform.
          </p>
        </div>
      )}
    </div>
  );
}
