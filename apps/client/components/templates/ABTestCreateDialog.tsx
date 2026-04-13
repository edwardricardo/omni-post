/**
 * @file ABTestCreateDialog.tsx
 * @component ABTestCreateDialog
 * @description Dialog for creating a new A/B test with variant configuration, traffic split, and scheduling.
 */

"use client";

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
import type { CreateFormState } from "./useABTestManager";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="flex items-center space-x-1">
          <Plus className="h-4 w-4" />
          <span>Create A/B Test</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Create A/B Test</DialogTitle>
          <DialogDescription>Set up a new A/B test to compare template variants</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Test Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="test-name">Test Name *</Label>
                  <Input
                    id="test-name"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter test name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-select">Base Template *</Label>
                  <Select
                    value={createForm.templateId}
                    onValueChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, templateId: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template" />
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
                <Label htmlFor="test-description">Description</Label>
                <Textarea
                  id="test-description"
                  value={createForm.description}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Describe what you're testing"
                  rows={3}
                />
              </div>
            </div>

            <Separator />

            {/* Variants */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Variants</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAddVariant}
                  disabled={createForm.variants.length >= 5}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Variant
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
                        placeholder="Enter variant content..."
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
            Cancel
          </Button>
          <Button
            onClick={onCreateTest}
            disabled={!createForm.name.trim() || !createForm.templateId}
          >
            Create Test
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
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Test Configuration</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start-date">Start Date</Label>
          <Input
            id="start-date"
            type="date"
            value={createForm.startDate}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, startDate: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="duration">Duration (days)</Label>
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
          <Label htmlFor="confidence">Confidence Threshold (%)</Label>
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
        <Label>Traffic Split</Label>
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
          Total: {createForm.trafficSplit.reduce((sum, val) => sum + val, 0)}%
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="auto-stop"
          checked={createForm.autoStop}
          onCheckedChange={(checked) => setCreateForm((prev) => ({ ...prev, autoStop: checked }))}
        />
        <Label htmlFor="auto-stop" className="text-sm">
          Auto-stop when confidence threshold is reached
        </Label>
      </div>
    </div>
  );
}
