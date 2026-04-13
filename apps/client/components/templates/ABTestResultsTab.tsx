/**
 * @file ABTestResultsTab.tsx
 * @component ABTestResultsTab
 * @description Results tab content for the ABTestManager, showing completed test metrics and variant performance.
 */

"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Alert, AlertDescription } from "@packages/ui";
import { BarChart3, Info } from "lucide-react";
import { type ABTest } from "./abTestTypes";

interface ABTestResultsTabProps {
  completedTests: ABTest[];
}

export function ABTestResultsTab({ completedTests }: ABTestResultsTabProps) {
  if (completedTests.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-muted-foreground">
            <BarChart3 className="h-8 w-8 mx-auto mb-2" />
            <p>No completed tests with results.</p>
            <p className="text-sm">Results will appear here once tests are completed.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {completedTests.map((test) => (
        <Card key={test.id}>
          <CardHeader>
            <CardTitle className="text-lg">{test.name}</CardTitle>
            <CardDescription>{test.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {test.results ? (
              <div className="space-y-4">
                {/* Overall metrics */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{test.results.totalViews}</p>
                    <p className="text-sm text-muted-foreground">Total Views</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{test.results.totalConversions}</p>
                    <p className="text-sm text-muted-foreground">Conversions</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">
                      {(test.results.overallConversionRate * 100).toFixed(2)}%
                    </p>
                    <p className="text-sm text-muted-foreground">Conversion Rate</p>
                  </div>
                </div>

                {/* Variant results */}
                <div className="space-y-2">
                  <h4 className="font-medium">Variant Performance</h4>
                  {test.results.variants.map((result) => {
                    const variant = test.config.variants.find((v) => v.id === result.variantId);
                    return (
                      <div
                        key={result.variantId}
                        className="flex items-center justify-between p-3 border rounded-sm"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="text-sm font-medium">{variant?.name}</div>
                          {result.isWinner && (
                            <Badge variant="default" className="text-xs">
                              Winner
                            </Badge>
                          )}
                          {result.isStatisticallySignificant && (
                            <Badge variant="outline" className="text-xs">
                              Significant
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-4 text-sm">
                          <span>{result.views} views</span>
                          <span>{result.conversions} conversions</span>
                          <span className="font-medium">
                            {(result.conversionRate * 100).toFixed(2)}%
                          </span>
                          <span className="text-muted-foreground">
                            {result.confidence.toFixed(1)}% conf.
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Recommendation */}
                {test.results.recommendedAction && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Recommendation:</strong>{" "}
                      {test.results.recommendedAction.replace(/_/g, " ")}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">No results available yet.</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
