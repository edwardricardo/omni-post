/**
 * @file CreateCampaignModal.tsx
 * @description Modal for creating new campaigns with UTM parameters.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Button, Input, Label } from "@packages/ui";
import { useCreateCampaign } from "@/hooks/api/useCampaigns";

interface CreateCampaignModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * @component CreateCampaignModal
 * @description Modal form for creating new campaigns with name, description, date range,
 * and optional UTM parameter configuration.
 */
export function CreateCampaignModal({ projectId, open, onClose }: CreateCampaignModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [showUtm, setShowUtm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus the name input when the modal opens.
  useEffect(() => {
    if (open) {
      nameInputRef.current?.focus();
    }
  }, [open]);

  const createMutation = useCreateCampaign();
  const canSubmit = name.trim().length > 0 && !createMutation.isPending;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      await createMutation.mutateAsync({
        projectId,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(utmSource.trim() ? { utmSource: utmSource.trim() } : {}),
        ...(utmMedium.trim() ? { utmMedium: utmMedium.trim() } : {}),
      });

      setName("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setUtmSource("");
      setUtmMedium("");
      onClose();
    },
    [
      projectId,
      name,
      description,
      startDate,
      endDate,
      utmSource,
      utmMedium,
      canSubmit,
      createMutation,
      onClose,
    ]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close modal"
        className="fixed inset-0 bg-black/25 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-50 w-full max-w-lg rounded-lg bg-card border shadow-lg p-6">
        <h2 className="text-lg font-semibold mb-4">New Campaign</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="campaign-name">Name *</Label>
            <Input
              ref={nameInputRef}
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring Product Launch"
            />
          </div>

          <div>
            <Label htmlFor="campaign-desc">Description</Label>
            <textarea
              id="campaign-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Campaign objectives and notes..."
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="campaign-start">Start Date</Label>
              <Input
                id="campaign-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="campaign-end">End Date</Label>
              <Input
                id="campaign-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowUtm(!showUtm)}
              className="text-sm text-primary hover:underline"
            >
              {showUtm ? "Hide UTM Parameters" : "Add UTM Parameters"}
            </button>

            {showUtm && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <Label htmlFor="utm-source">utm_source</Label>
                  <Input
                    id="utm-source"
                    value={utmSource}
                    onChange={(e) => setUtmSource(e.target.value)}
                    placeholder="social"
                  />
                </div>
                <div>
                  <Label htmlFor="utm-medium">utm_medium</Label>
                  <Input
                    id="utm-medium"
                    value={utmMedium}
                    onChange={(e) => setUtmMedium(e.target.value)}
                    placeholder="post"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createMutation.isPending ? "Creating..." : "Create Campaign"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
