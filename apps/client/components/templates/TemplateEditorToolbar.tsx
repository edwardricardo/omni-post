"use client";

/**
 * @file TemplateEditorToolbar.tsx
 * @component TemplateEditorToolbar
 * @description Header toolbar for the TemplateEditor, rendering the title, validation button,
 * cancel, and save actions.
 * @layer infrastructure
 */

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { CheckCircle, Save } from "lucide-react";
import type { TemplateEditorToolbarProps } from "./templateEditorTypes.js";

export function TemplateEditorToolbar({
  template,
  formData,
  isSaving,
  onValidate,
  onCancel,
  onSave,
}: TemplateEditorToolbarProps) {
  const t = useTranslations("templates.components.editor");
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold">{template ? t("editTitle") : t("createTitle")}</h2>
        <p className="text-muted-foreground">
          {template ? t("editingSubtitle", { name: template.name }) : t("createSubtitle")}
        </p>
      </div>
      <div className="flex items-center space-x-2">
        <Button variant="outline" onClick={onValidate} className="flex items-center space-x-1">
          <CheckCircle className="h-4 w-4" />
          <span>{t("validate")}</span>
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          onClick={onSave}
          disabled={isSaving || !formData.name?.trim() || !formData.content?.trim()}
          className="flex items-center space-x-1"
        >
          <Save className="h-4 w-4" />
          <span>{isSaving ? t("saving") : t("save")}</span>
        </Button>
      </div>
    </div>
  );
}
