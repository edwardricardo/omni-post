/**
 * @file PostsEmptyState.tsx
 * @description Empty state for the posts list. Different copy depending
 *              on whether the user has filters applied — `hasFilters`
 *              flag distinguishes "no posts at all" from "no matches".
 * @component PostsEmptyState
 * @layer infrastructure
 */

import { useTranslations } from "next-intl";
import { FileText, PlusCircle } from "lucide-react";
import { Button, Card, CardContent } from "@packages/ui";

interface PostsEmptyStateProps {
  hasFilters: boolean;
  onCreate: () => void;
}

export function PostsEmptyState({ hasFilters, onCreate }: PostsEmptyStateProps) {
  const t = useTranslations("posts");
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center py-12">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">{t("empty.heading")}</h3>
          <p className="text-muted-foreground mb-4">
            {hasFilters ? t("empty.filtered") : t("empty.description")}
          </p>
          <Button onClick={onCreate}>
            <PlusCircle className="mr-2 h-4 w-4" />
            {t("createButton")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
