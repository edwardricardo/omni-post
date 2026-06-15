/**
 * @file useABTestManager.ts
 * @description Custom hook encapsulating all state management and handlers for the ABTestManager component.
 * @hook useABTestManager
 * @layer infrastructure
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { format, addDays } from "date-fns";
import { type TemplateVariant, type ABTestConfig } from "@/lib/templates/templateEngine";
import { useToast } from "@packages/ui";
import { type ABTest, type ABTestManagerProps } from "./abTestTypes";

export interface CreateFormState {
  name: string;
  description: string;
  templateId: string;
  variants: Array<{ name: string; content: string; weight: number }>;
  trafficSplit: number[];
  duration: number;
  startDate: string;
  autoStop: boolean;
  confidenceThreshold: number;
}

function getDefaultCreateForm(): CreateFormState {
  return {
    name: "",
    description: "",
    templateId: "",
    variants: [
      { name: "Variant A", content: "", weight: 50 },
      { name: "Variant B", content: "", weight: 50 },
    ],
    trafficSplit: [50, 50],
    duration: 7,
    startDate: format(new Date(), "yyyy-MM-dd"),
    autoStop: true,
    confidenceThreshold: 95,
  };
}

interface UseABTestManagerParams {
  templates: ABTestManagerProps["templates"];
  onTestCreate?: ABTestManagerProps["onTestCreate"];
  onTestDelete?: ABTestManagerProps["onTestDelete"];
  onTestStart?: ABTestManagerProps["onTestStart"];
  onTestPause?: ABTestManagerProps["onTestPause"];
  onTestStop?: ABTestManagerProps["onTestStop"];
  tests?: ABTestManagerProps["tests"];
}

export function useABTestManager({
  templates,
  onTestCreate,
  onTestDelete,
  onTestStart,
  onTestPause,
  onTestStop,
  tests = [],
}: UseABTestManagerParams) {
  const { success, error } = useToast();

  // State
  const [activeTab, setActiveTab] = useState<"overview" | "create" | "results">("overview");
  const [_selectedTest, setSelectedTest] = useState<ABTest | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [testToDelete, setTestToDelete] = useState<ABTest | null>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(getDefaultCreateForm);

  // Computed values
  const runningTests = useMemo(() => tests.filter((test) => test.status === "running"), [tests]);
  const completedTests = useMemo(
    () => tests.filter((test) => test.status === "completed"),
    [tests]
  );
  const draftTests = useMemo(() => tests.filter((test) => test.status === "draft"), [tests]);

  // Handlers
  const handleCreateTest = useCallback(async () => {
    try {
      if (!createForm.name.trim() || !createForm.templateId) {
        error({ description: "Please fill in required fields" });
        return;
      }

      const selectedTemplate = templates.find((t) => t.id === createForm.templateId);
      if (!selectedTemplate) {
        error({ description: "Selected template not found" });
        return;
      }

      if (createForm.variants.some((v) => !v.content.trim())) {
        error({ description: "All variants must have content" });
        return;
      }

      const templateVariants: TemplateVariant[] = createForm.variants.map((variant, index) => ({
        id: `variant-${index + 1}`,
        name: variant.name,
        content: variant.content,
        weight: variant.weight,
      }));

      const config: ABTestConfig = {
        enabled: true,
        variants: templateVariants,
        trafficSplit: createForm.trafficSplit,
        startDate: new Date(createForm.startDate),
        endDate: addDays(new Date(createForm.startDate), createForm.duration),
      };

      const newTest: ABTest = {
        id: `test-${Date.now()}`,
        name: createForm.name,
        description: createForm.description,
        templateId: createForm.templateId,
        config,
        status: "draft",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await onTestCreate?.(newTest);
      setCreateForm(getDefaultCreateForm());
      setCreateDialogOpen(false);
      success({ description: "A/B test created successfully!" });
    } catch {
      error({ description: "Failed to create A/B test" });
    }
  }, [createForm, templates, onTestCreate, success, error]);

  const handleStartTest = useCallback(
    async (test: ABTest) => {
      try {
        await onTestStart?.(test.id);
        success({ description: `Started A/B test: ${test.name}` });
      } catch {
        error({ description: "Failed to start test" });
      }
    },
    [onTestStart, success, error]
  );

  const handlePauseTest = useCallback(
    async (test: ABTest) => {
      try {
        await onTestPause?.(test.id);
        success({ description: `Paused A/B test: ${test.name}` });
      } catch {
        error({ description: "Failed to pause test" });
      }
    },
    [onTestPause, success, error]
  );

  const handleStopTest = useCallback(
    async (test: ABTest) => {
      try {
        await onTestStop?.(test.id);
        success({ description: `Stopped A/B test: ${test.name}` });
      } catch {
        error({ description: "Failed to stop test" });
      }
    },
    [onTestStop, success, error]
  );

  const handleDeleteTest = useCallback((test: ABTest) => {
    setTestToDelete(test);
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (testToDelete) {
      try {
        await onTestDelete?.(testToDelete.id);
        success({ description: `Deleted A/B test: ${testToDelete.name}` });
      } catch {
        error({ description: "Failed to delete test" });
      }
    }
    setDeleteConfirmOpen(false);
    setTestToDelete(null);
  }, [testToDelete, onTestDelete, success, error]);

  const addVariant = useCallback(() => {
    const newWeight = Math.floor(100 / (createForm.variants.length + 1));
    const newVariants = [
      ...createForm.variants.map((v) => ({ ...v, weight: newWeight })),
      {
        name: `Variant ${String.fromCharCode(65 + createForm.variants.length)}`,
        content: "",
        weight: newWeight,
      },
    ];
    const newTrafficSplit = new Array(newVariants.length).fill(newWeight);

    setCreateForm((prev) => ({
      ...prev,
      variants: newVariants,
      trafficSplit: newTrafficSplit,
    }));
  }, [createForm.variants]);

  const removeVariant = useCallback(
    (index: number) => {
      if (createForm.variants.length <= 2) return;

      const newVariants = createForm.variants.filter((_, i) => i !== index);
      const newWeight = Math.floor(100 / newVariants.length);
      const updatedVariants = newVariants.map((v) => ({ ...v, weight: newWeight }));
      const newTrafficSplit = new Array(updatedVariants.length).fill(newWeight);

      setCreateForm((prev) => ({
        ...prev,
        variants: updatedVariants,
        trafficSplit: newTrafficSplit,
      }));
    },
    [createForm.variants]
  );

  const updateVariantContent = useCallback((index: number, content: string) => {
    setCreateForm((prev) => ({
      ...prev,
      variants: prev.variants.map((v, i) => (i === index ? { ...v, content } : v)),
    }));
  }, []);

  const updateTrafficSplit = useCallback((newSplit: number[]) => {
    setCreateForm((prev) => ({
      ...prev,
      trafficSplit: newSplit,
      variants: prev.variants.map((v, i) => ({
        ...v,
        weight: newSplit[i] || 0,
      })),
    }));
  }, []);

  return {
    // State
    activeTab,
    setActiveTab,
    setSelectedTest,
    createDialogOpen,
    setCreateDialogOpen,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    testToDelete,
    createForm,
    setCreateForm,

    // Computed
    runningTests,
    completedTests,
    draftTests,

    // Handlers
    handleCreateTest,
    handleStartTest,
    handlePauseTest,
    handleStopTest,
    handleDeleteTest,
    confirmDelete,
    addVariant,
    removeVariant,
    updateVariantContent,
    updateTrafficSplit,
  };
}
