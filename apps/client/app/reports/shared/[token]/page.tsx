/**
 * @file page.tsx
 * @component SharedReportPage
 * @description Public shared report page — no authentication required.
 *              Displays a read-only view of a custom analytics report.
 * @layer client-pages
 */

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ReportData {
  reportId: string;
  name: string;
  dateRange: string;
  labels: string[];
  datasets: { label: string; data: number[] }[];
  hasData: boolean;
}

export default function SharedReportPage() {
  const params = useParams();
  const token = params.token as string;

  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch(`/api/backend/reports/public/${token}`);
        if (!res.ok) {
          if (res.status === 404) setError("This report is no longer available.");
          else if (res.status === 410) setError("This report link has expired.");
          else setError("Failed to load report.");
          return;
        }
        const data = (await res.json()) as { ok: boolean; value?: ReportData };
        if (data.ok && data.value) {
          setReport(data.value);
        } else {
          setError("Failed to load report data.");
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    fetchReport();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-muted-foreground">Loading report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Report Unavailable</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!report || !report.hasData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">{report?.name ?? "Report"}</h1>
          <p className="text-muted-foreground">No data available for this report yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg border shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-foreground">{report.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">Date range: {report.dateRange}</p>
        </div>

        <div className="bg-white rounded-lg border shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Metrics</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Period</th>
                  {report.datasets.map((ds) => (
                    <th
                      key={ds.label}
                      className="text-right py-2 px-3 font-medium text-muted-foreground"
                    >
                      {ds.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.labels.map((label, i) => (
                  <tr key={label} className="border-b last:border-b-0">
                    <td className="py-2 px-3 font-medium">{label}</td>
                    {report.datasets.map((ds) => (
                      <td key={ds.label} className="text-right py-2 px-3">
                        {(ds.data[i] ?? 0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-center py-6 text-xs text-muted-foreground">
          <p>Powered by OmniPost</p>
        </div>
      </div>
    </div>
  );
}
