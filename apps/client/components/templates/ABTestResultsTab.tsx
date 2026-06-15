/**
 * @file ABTestResultsTab.tsx
 * @description Results tab content for the ABTestManager, showing completed test metrics and variant performance.
 * @component ABTestResultsTab
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Alert, AlertDescription } from "@packages/ui";
import { BarChart3, Info } from "lucide-react";
import { type ABTest } from "./abTestTypes";

interface ABTestResultsTabProps {
  completedTests: ABTest[];
}

export function ABTestResultsTab({ completedTests }: ABTestResultsTabProps) {
  const t = useTranslations("templates.components.abTest");
  if (completedTests.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-muted-foreground">
            <BarChart3 className="h-8 w-8 mx-auto mb-2" />
            <p>{t("results.empty")}</p>
            <p className="text-sm">{t("results.emptyHint")}</p>
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
                    <p className="text-sm text-muted-foreground">{t("results.totalViews")}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">{test.results.totalConversions}</p>
                    <p className="text-sm text-muted-foreground">{t("results.conversions")}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">
                      {(test.results.overallConversionRate * 100).toFixed(2)}%
                    </p>
                    <p className="text-sm text-muted-foreground">{t("results.conversionRate")}</p>
                  </div>
                </div>

                {/* Variant results */}
                <div className="space-y-2">
                  <h4 className="font-medium">{t("results.variantPerformance")}</h4>
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
                              {t("results.winner")}
                            </Badge>
                          )}
                          {result.isStatisticallySignificant && (
                            <Badge variant="outline" className="text-xs">
                              {t("results.significant")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center space-x-4 text-sm">
                          <span>{t("results.viewsCount", { count: result.views })}</span>
                          <span>
                            {t("results.conversionsCount", { count: result.conversions })}
                          </span>
                          <span className="font-medium">
                            {(result.conversionRate * 100).toFixed(2)}%
                          </span>
                          <span className="text-muted-foreground">
                            {t("results.confidence", { value: result.confidence.toFixed(1) })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Recommendation */}
                {test.results.recommendedAction && (
                  <Alert>
                    <Info aria-hidden="true" className="h-4 w-4" />
                    <AlertDescription>
                      <strong>{t("results.recommendation")}</strong>{" "}
                      {test.results.recommendedAction.replace(/_/g, " ")}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("results.noneYet")}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
