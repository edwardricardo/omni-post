"use client";

/**
 * @file RulesView.tsx
 * @component RulesView
 * @description Scheduling rules management view that lists and allows editing of automated
 * scheduling rules defining when and how posts are published across platforms.
 */

import React from "react";
import type { SchedulingRule } from "../../../types/multi-platform-scheduling";

interface RulesViewProps {
  rules: SchedulingRule[];
  onAddRule: () => void;
  onEditRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string, active: boolean) => void;
}

export function RulesView({ rules, onAddRule, onEditRule, onToggleRule }: RulesViewProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium">Scheduling Rules</h3>
            <p className="text-sm text-gray-600 mt-1">
              Automate your posting schedule with custom rules
            </p>
          </div>
          <button
            onClick={onAddRule}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500"
            aria-label="Add new scheduling rule"
          >
            + Add Rule
          </button>
        </div>

        {rules.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-4" aria-hidden="true">
              ⚙️
            </div>
            <h4 className="text-lg font-semibold text-gray-900 mb-2">No Scheduling Rules</h4>
            <p className="text-sm mb-4">
              Create rules to automate when and how often content is posted
            </p>
            <button
              onClick={onAddRule}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Create Your First Rule
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="border rounded-lg p-4 hover:shadow-xs transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-gray-900">{rule.name}</h4>
                    {rule.description && (
                      <p className="text-sm text-gray-500 mt-0.5">{rule.description}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.isActive}
                        onChange={(e) => onToggleRule(rule.id, e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label={`Toggle ${rule.name} rule`}
                      />
                      <span
                        className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${
                          rule.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {rule.isActive ? "Active" : "Inactive"}
                      </span>
                    </label>
                    <button
                      onClick={() => onEditRule(rule.id)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium focus:outline-hidden focus:underline"
                      aria-label={`Edit ${rule.name} rule`}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600 font-medium">Platforms:</span>
                    <div className="mt-1">
                      <div className="flex flex-wrap gap-1">
                        {rule.platforms.map((platform) => (
                          <span
                            key={platform}
                            className="px-2 py-1 bg-blue-100 text-blue-700 rounded-sm text-xs capitalize"
                          >
                            {platform}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600 font-medium">Content Types:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {rule.contentTypes.length > 0 ? (
                        rule.contentTypes.map((ct) => (
                          <span key={ct} className="text-xs text-gray-600">
                            {ct}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-400">All types</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-600 font-medium">Limits:</span>
                    <div className="mt-1 space-y-1">
                      {rule.maxPostsPerDay !== null && (
                        <div className="text-xs">Max {rule.maxPostsPerDay} posts/day</div>
                      )}
                      {rule.maxPostsPerHour !== null && (
                        <div className="text-xs">Max {rule.maxPostsPerHour} posts/hour</div>
                      )}
                      {rule.minIntervalMinutes !== null && (
                        <div className="text-xs">Min {rule.minIntervalMinutes}m interval</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Performance stats */}
                {(rule.successRate !== null || rule.avgPerformance !== null) && (
                  <div className="mt-3 pt-3 border-t flex gap-4 text-xs text-gray-500">
                    <span>Applied {rule.timesApplied} times</span>
                    {rule.successRate !== null && (
                      <span>{Math.round(rule.successRate * 100)}% success rate</span>
                    )}
                    {rule.avgPerformance !== null && (
                      <span>Avg. performance: {Math.round(rule.avgPerformance)}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">💡 Rule Examples</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Post to Twitter daily between 9 AM - 5 PM, max 5 posts</li>
          <li>• Post to LinkedIn on weekdays only, minimum 4 hours apart</li>
          <li>• Post to Instagram daily at optimal times, max 3 posts</li>
        </ul>
      </div>
    </div>
  );
}
