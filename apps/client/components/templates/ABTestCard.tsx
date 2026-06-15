/**
 * @file ABTestCard.tsx
 * @description Card component displaying an individual A/B test's status, metrics, variant breakdown, and action controls.
 * @component ABTestCard
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@packages/ui";
import {
  Play,
  Pause,
  Square,
  BarChart3,
  TrendingUp,
  Eye,
  MoreVertical,
  Copy,
  Download,
  Trash2,
} from "lucide-react";
import { differenceInDays } from "date-fns";
import { type ABTest, getStatusColor } from "./abTestTypes";

interface ABTestCardProps {
  test: ABTest;
  allowManagement: boolean;
  onStart: (test: ABTest) => void;
  onPause: (test: ABTest) => void;
  onStop: (test: ABTest) => void;
  onDelete: (test: ABTest) => void;
  onSelect: (test: ABTest) => void;
}

export function ABTestCard({
  test,
  allowManagement,
  onStart,
  onPause,
  onStop,
  onDelete,
  onSelect,
}: ABTestCardProps) {
  const t = useTranslations("templates.components.abTest");
  return (
    <Card key={test.id} className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm">{test.name}</CardTitle>
            <CardDescription className="text-xs">{test.description}</CardDescription>
          </div>
          <div className="flex items-center space-x-2 ml-2">
            <div className={`w-2 h-2 rounded-full ${getStatusColor(test.status)}`} />
            <Badge variant="outline" className="text-xs">
              {t(`status.${test.status}`)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">{t("card.variants")}</span>
            <span className="ml-1">{test.config.variants.length}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("card.duration")}</span>
            <span className="ml-1">
              {test.startDate && test.endDate
                ? t("card.days", { count: differenceInDays(test.endDate, test.startDate) })
                : t("card.notSet")}
            </span>
          </div>
        </div>

        {test.results && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t("card.results")}</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">{t("card.views")}</span>
                <span className="ml-1 font-medium">{test.results.totalViews}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("card.convRate")}</span>
                <span className="ml-1 font-medium">
                  {(test.results.overallConversionRate * 100).toFixed(1)}%
                </span>
              </div>
            </div>
            {test.results.winnerVariantId && (
              <div className="flex items-center space-x-1 text-xs">
                <TrendingUp className="h-3 w-3 text-green-500" />
                <span className="text-green-600">
                  {t("card.winner", {
                    name:
                      test.config.variants.find((v) => v.id === test.results?.winnerVariantId)
                        ?.name ?? "",
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex space-x-1">
            {test.status === "draft" && allowManagement && (
              <Button size="sm" onClick={() => onStart(test)} className="text-xs">
                <Play className="h-3 w-3 mr-1" />
                {t("card.start")}
              </Button>
            )}
            {test.status === "running" && allowManagement && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPause(test)}
                  className="text-xs"
                >
                  <Pause className="h-3 w-3 mr-1" />
                  {t("card.pause")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStop(test)}
                  className="text-xs"
                >
                  <Square className="h-3 w-3 mr-1" />
                  {t("card.stop")}
                </Button>
              </>
            )}
            {test.status === "paused" && allowManagement && (
              <Button size="sm" onClick={() => onStart(test)} className="text-xs">
                <Play className="h-3 w-3 mr-1" />
                {t("card.resume")}
              </Button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("card.actions")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onSelect(test)}>
                <Eye className="h-3 w-3 mr-1" />
                {t("card.viewDetails")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSelect(test)}>
                <BarChart3 className="h-3 w-3 mr-1" />
                {t("card.viewResults")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {allowManagement && (
                <>
                  <DropdownMenuItem>
                    <Copy className="h-3 w-3 mr-1" />
                    {t("card.duplicate")}
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Download className="h-3 w-3 mr-1" />
                    {t("card.exportResults")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onDelete(test)} className="text-red-600">
                    <Trash2 className="h-3 w-3 mr-1" />
                    {t("card.delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
