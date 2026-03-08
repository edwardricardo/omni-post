"use client";

/**
 * @file SmartContentOptimizerOverview.tsx
 * @description Overview tab content for the SmartContentOptimizer, displaying engagement,
 * readability, virality, and SEO score cards alongside content statistics and sentiment analysis.
 */

import React from "react";
import { TrendingUp, Target, Eye, Zap } from "lucide-react";
import type { ContentAnalysis } from "./smartContentOptimizerUtils";

interface SmartContentOptimizerOverviewProps {
  analysis: ContentAnalysis;
}

export function SmartContentOptimizerOverview({ analysis }: SmartContentOptimizerOverviewProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-linear-to-r from-blue-50 to-blue-100 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-900">Engagement</p>
              <p className="text-2xl font-bold text-blue-700">
                {Math.round(analysis.engagementPotential)}%
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-linear-to-r from-green-50 to-green-100 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-900">Readability</p>
              <p className="text-2xl font-bold text-green-700">
                {Math.round(analysis.readabilityScore)}%
              </p>
            </div>
            <Eye className="w-8 h-8 text-green-500" />
          </div>
        </div>

        <div className="bg-linear-to-r from-purple-50 to-purple-100 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-purple-900">Virality</p>
              <p className="text-2xl font-bold text-purple-700">
                {Math.round(analysis.viralityIndex)}%
              </p>
            </div>
            <Zap className="w-8 h-8 text-purple-500" />
          </div>
        </div>

        <div className="bg-linear-to-r from-orange-50 to-orange-100 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-orange-900">SEO Score</p>
              <p className="text-2xl font-bold text-orange-700">{Math.round(analysis.seoScore)}%</p>
            </div>
            <Target className="w-8 h-8 text-orange-500" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Content Statistics</h4>
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Word Count:</span>
              <span className="font-medium">{analysis.wordCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Character Count:</span>
              <span className="font-medium">{analysis.characterCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Read Time:</span>
              <span className="font-medium">{analysis.estimatedReadTime} min</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Keyword Density:</span>
              <span className="font-medium">{analysis.keywordDensity.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Sentiment Analysis</h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Sentiment Score</span>
              <span
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  analysis.sentimentScore > 0.5
                    ? "bg-green-100 text-green-800"
                    : analysis.sentimentScore < -0.1
                      ? "bg-red-100 text-red-800"
                      : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {analysis.sentimentScore > 0.5
                  ? "Positive"
                  : analysis.sentimentScore < -0.1
                    ? "Negative"
                    : "Neutral"}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.abs(analysis.sentimentScore) * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
