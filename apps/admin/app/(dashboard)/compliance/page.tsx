/**
 * @file page.tsx
 * @description Compliance dashboard page presenting GDPR, security, and audit status metrics.
 * Tabbed interface fetches compliance data via the useCompliance hook.
 */
"use client";

import { useState } from "react";
import { useCompliance } from "@/hooks/api/useCompliance";

function CompliancePageContent() {
  const { data, isLoading, error } = useCompliance();
  const [activeTab, setActiveTab] = useState<"overview" | "gdpr" | "security" | "audit">(
    "overview"
  );

  const metrics = data?.metrics || [];
  const auditLogs = data?.auditLogs || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "compliant":
        return "bg-green-100 text-green-800";
      case "warning":
        return "bg-yellow-100 text-yellow-800";
      case "non-compliant":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getResultColor = (result: string) => {
    return result === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800";
  };

  const overallScore = Math.round(metrics.reduce((acc, m) => acc + m.score, 0) / metrics.length);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded-sm mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-sm"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading Compliance Dashboard</h3>
          <p className="text-red-600 mt-1">{error.message}</p>
          <p className="text-sm text-gray-600 mt-2">
            Backend compliance endpoints need to be implemented.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Compliance Monitoring Center</h1>
        <p className="text-gray-600">Monitor regulatory compliance and security standards</p>
      </div>

      {/* Overall Compliance Score */}
      <div className="bg-white p-6 rounded-lg shadow-sm border mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Overall Compliance Score</h2>
          <div className="flex items-center space-x-2">
            <div
              className={`w-4 h-4 rounded-full ${
                overallScore >= 90
                  ? "bg-green-500"
                  : overallScore >= 75
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
            ></div>
            <span className="text-2xl font-bold text-gray-900">{overallScore}%</span>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              overallScore >= 90
                ? "bg-green-500"
                : overallScore >= 75
                  ? "bg-yellow-500"
                  : "bg-red-500"
            }`}
            style={{ width: `${overallScore}%` }}
          ></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { key: "overview", label: "Overview" },
              { key: "gdpr", label: "GDPR/Privacy" },
              { key: "security", label: "Security" },
              { key: "audit", label: "Audit Logs" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {metrics.map((metric) => (
            <div key={metric.id} className="bg-white p-6 rounded-lg shadow-sm border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{metric.name}</h3>
                  <p className="text-sm text-gray-600">{metric.description}</p>
                </div>
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(metric.status)}`}
                >
                  {metric.status.toUpperCase().replace("-", " ")}
                </span>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-600">Compliance Score</span>
                  <span className="text-sm font-medium text-gray-900">{metric.score}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      metric.score >= 90
                        ? "bg-green-500"
                        : metric.score >= 75
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    }`}
                    style={{ width: `${metric.score}%` }}
                  ></div>
                </div>
              </div>

              <div className="mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Requirements</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  {metric.requirements.map((req, index) => (
                    <li key={index} className="flex items-start">
                      <span className="text-green-500 mr-2">•</span>
                      {req}
                    </li>
                  ))}
                </ul>
              </div>

              {metric.actions && metric.actions.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-red-700 mb-2">Required Actions</h4>
                  <ul className="text-sm text-red-600 space-y-1">
                    {metric.actions.map((action, index) => (
                      <li key={index} className="flex items-start">
                        <span className="text-red-500 mr-2">⚠</span>
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 text-xs text-gray-500">
                Last checked: {new Date(metric.lastChecked).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "audit" && (
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Audit Events</h2>
            <p className="text-sm text-gray-600">Security and compliance related events</p>
          </div>
          <div className="divide-y divide-gray-200">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getResultColor(log.result)}`}
                      >
                        {log.result.toUpperCase()}
                      </span>
                      <span className="font-medium text-gray-900">
                        {log.action.replace("_", " ")}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      <span className="font-medium">{log.user}</span> → {log.resource}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">{log.details}</div>
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(activeTab === "gdpr" || activeTab === "security") && (
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="text-center py-8">
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {activeTab === "gdpr" ? "GDPR/Privacy Compliance" : "Security Compliance"}
            </h3>
            <p className="text-gray-600 mb-4">
              Detailed {activeTab} compliance metrics and controls coming soon
            </p>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700">
              Configure {activeTab.toUpperCase()} Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return <CompliancePageContent />;
}
