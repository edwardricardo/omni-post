/**
 * @file HelpersTab.tsx
 * @description Helpers tab content. Category select + cards for each
 *              Handlebars helper. Each card shows the helper name,
 *              description, example, and two buttons: Copy syntax to
 *              clipboard, Insert syntax into the editor.
 * @component HelpersTab
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { Copy, Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@packages/ui";
import type { HelperInfo } from "./data";

interface HelpersTabProps {
  helpers: HelperInfo[];
  categories: string[];
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  onCopyHelper: (syntax: string) => void;
  onInsertHelper: (helper: HelperInfo) => void;
}

export function HelpersTab({
  helpers,
  categories,
  selectedCategory,
  onCategoryChange,
  onCopyHelper,
  onInsertHelper,
}: HelpersTabProps) {
  const t = useTranslations("templates.components.variableInserter");
  return (
    <div className="space-y-4">
      <Select value={selectedCategory} onValueChange={onCategoryChange}>
        <SelectTrigger className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {categories.map((category) => (
            <SelectItem key={category} value={category} className="text-xs">
              {category === "all" ? t("allCategories") : category}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="space-y-2">
        {helpers.map((helper, index) => (
          <Card key={index} className="p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                  {helper.name}
                </Badge>
                <div className="flex space-x-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCopyHelper(helper.syntax)}
                        className="h-6 w-6 p-0"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("copySyntax")}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onInsertHelper(helper)}
                        className="h-6 w-6 p-0"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("insertHelper")}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{helper.description}</p>
              <code className="block text-xs bg-muted p-2 rounded-sm">{helper.example}</code>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
