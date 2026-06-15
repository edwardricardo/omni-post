/**
 * @file ABTestStatsCards.tsx
 * @description Summary statistics cards for the A/B Test Manager: total tests, running, completed, and drafts.
 * @component ABTestStatsCards
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@packages/ui";
import { BarChart3, Play, CheckCircle, Clock } from "lucide-react";
import { type ABTest } from "./abTestTypes.js";

interface ABTestStatsCardsProps {
  tests: ABTest[];
  runningCount: number;
  completedCount: number;
  draftCount: number;
}

export function ABTestStatsCards({
  tests,
  runningCount,
  completedCount,
  draftCount,
}: ABTestStatsCardsProps) {
  const t = useTranslations("templates.components.abTest");
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <BarChart3 className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("stats.totalTests")}</p>
              <p className="text-2xl font-bold">{tests.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Play className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("stats.running")}</p>
              <p className="text-2xl font-bold">{runningCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-purple-100 rounded-lg">
              <CheckCircle className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("stats.completed")}</p>
              <p className="text-2xl font-bold">{completedCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-gray-100 rounded-lg">
              <Clock className="h-4 w-4 text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("stats.drafts")}</p>
              <p className="text-2xl font-bold">{draftCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
