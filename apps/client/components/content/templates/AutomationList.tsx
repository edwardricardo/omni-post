"use client";

/**
 * @file AutomationList.tsx
 * @description List container that renders a collection of AutomationCard components,
 * displaying all automation rules with an empty state when none exist.
 */

import React from "react";
import { Wand2 } from "lucide-react";
import { AutomationCard } from "./AutomationCard";
import type { AutomationTemplate } from "./types";

interface AutomationListProps {
  automations: AutomationTemplate[];
  onAutomationToggle: (automationId: string, active: boolean) => void;
  onAutomationCreate: (automation: Partial<AutomationTemplate>) => void;
}

/**
 * @component AutomationList
 * @description List container rendering AutomationCard components for all automation
 * rules, with an empty state and create-first-automation prompt when none exist.
 */
export const AutomationList: React.FC<AutomationListProps> = ({
  automations,
  onAutomationToggle,
  onAutomationCreate,
}) => {
  if (automations.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Wand2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No automation rules configured</p>
        <button
          onClick={() => onAutomationCreate({})}
          className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
        >
          Create Your First Automation
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {automations.map((automation) => (
        <AutomationCard key={automation.id} automation={automation} onToggle={onAutomationToggle} />
      ))}
    </div>
  );
};
