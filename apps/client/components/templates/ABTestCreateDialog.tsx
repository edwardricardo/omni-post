/**
 * @file ABTestCreateDialog.tsx
 * @description Dialog for creating a new A/B test with variant configuration, traffic split, and scheduling.
 * @component ABTestCreateDialog
 * @layer infrastructure
 */

"use client";

import { useTranslations } from "next-intl";
import { Button } from "@packages/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@packages/ui";
import { Input } from "@packages/ui";
import { Label } from "@packages/ui";
import { Textarea } from "@packages/ui";
import { ScrollArea, Separator, Switch, Slider } from "@packages/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@packages/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@packages/ui";
import { Plus, Trash2 } from "lucide-react";
import type { Template } from "@/lib/templates/templateEngine";
import type { CreateFormState } from "./useABTestManager.js";

interface ABTestCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createForm: CreateFormState;
  setCreateForm: React.Dispatch<React.SetStateAction<CreateFormState>>;
  templates: Template[];
  onCreateTest: () => Promise<void>;
  onAddVariant: () => void;
  onRemoveVariant: (index: number) => void;
  onUpdateVariantContent: (index: number, content: string) => void;
  onUpdateTrafficSplit: (newSplit: number[]) => void;
}

export function ABTestCreateDialog({
  open,
  onOpenChange,
  createForm,
  setCreateForm,
  templates,
  onCreateTest,
  onAddVariant,
  onRemoveVariant,
  onUpdateVariantContent,
  onUpdateTrafficSplit,
}: ABTestCreateDialogProps) {
  const t = useTranslations("templates.components.abTest");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="flex items-center space-x-1">
          <Plus className="h-4 w-4" />
          <span>{t("create.trigger")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">{t("create.testInformation")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="test-name">{t("create.testName")}</Label>
                  <Input
                    id="test-name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={t("create.testNamePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-select">{t("create.baseTemplate")}</Label>
                  <Select
                    value={createForm.templateId}
                    onValueChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, templateId: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("create.selectTemplate")} />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-description">{t("create.descriptionLabel")}</Label>
                <Textarea
                  id="test-description"
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder={t("create.descriptionPlaceholder")}
                  rows={3}
                />
              </div>
            </div>

            <Separator />

            {/* Variants */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">{t("create.variants")}</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAddVariant}
                  disabled={createForm.variants.length >= 5}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("create.addVariant")}
                </Button>
              </div>

              <div className="space-y-4">
                {createForm.variants.map((variant, index) => (
                  <Card key={index}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{variant.name}</CardTitle>
                        {createForm.variants.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onRemoveVariant(index)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={variant.content}
                        onChange={(e) => onUpdateVariantContent(index, e.target.value)}
                        placeholder={t("create.variantContentPlaceholder")}
                        rows={6}
                        className="font-mono text-sm"
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <Separator />

            {/* Test Configuration */}
            <TestConfigSection
              createForm={createForm}
              setCreateForm={setCreateForm}
              onUpdateTrafficSplit={onUpdateTrafficSplit}
            />
          </div>
        </ScrollArea>

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("create.cancel")}
          </Button>
          <Button
            onClick={onCreateTest}
            disabled={!createForm.name.trim() || !createForm.templateId}
          >
            {t("create.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-component for test configuration fields
// ---------------------------------------------------------------------------

interface TestConfigSectionProps {
  createForm: CreateFormState;
  setCreateForm: React.Dispatch<React.SetStateAction<CreateFormState>>;
  onUpdateTrafficSplit: (newSplit: number[]) => void;
}

function TestConfigSection({
  createForm,
  setCreateForm,
  onUpdateTrafficSplit,
}: TestConfigSectionProps) {
  const t = useTranslations("templates.components.abTest");
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">{t("create.testConfiguration")}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start-date">{t("create.startDate")}</Label>
          <Input
            id="start-date"
            type="date"
            value={createForm.startDate}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, startDate: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="duration">{t("create.duration")}</Label>
          <Input
            id="duration"
            type="number"
            min="1"
            max="30"
            value={createForm.duration}
            onChange={(e) =>
              setCreateForm((prev) => ({
                ...prev,
                duration: parseInt(e.target.value) || 7,
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confidence">{t("create.confidenceThreshold")}</Label>
          <Input
            id="confidence"
            type="number"
            min="80"
            max="99"
            value={createForm.confidenceThreshold}
            onChange={(e) =>
              setCreateForm((prev) => ({
                ...prev,
                confidenceThreshold: parseInt(e.target.value) || 95,
              }))
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("create.trafficSplit")}</Label>
        <div className="space-y-2">
          {createForm.variants.map((variant, index) => (
            <div key={index} className="flex items-center space-x-3">
              <div className="w-20 text-sm">{variant.name}:</div>
              <div className="flex-1">
                <Slider
                  value={[createForm.trafficSplit[index] ?? 0]}
                  onValueChange={(value: number[]) => {
                    const newSplit = [...createForm.trafficSplit];
                    newSplit[index] = value[0] ?? 0;
                    const total = newSplit.reduce((sum, val) => sum + val, 0);
                    if (total <= 100) {
                      onUpdateTrafficSplit(newSplit);
                    }
                  }}
                  max={100}
                  step={5}
                  className="flex-1"
                />
              </div>
              <div className="w-12 text-sm text-right">{createForm.trafficSplit[index] || 0}%</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("create.total", { value: createForm.trafficSplit.reduce((sum, val) => sum + val, 0) })}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="auto-stop"
          checked={createForm.autoStop}
          onCheckedChange={(checked) => setCreateForm((prev) => ({ ...prev, autoStop: checked }))}
        />
        <Label htmlFor="auto-stop" className="text-sm">
          {t("create.autoStop")}
        </Label>
      </div>
    </div>
  );
}
