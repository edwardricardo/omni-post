/**
 * @file VariablesTab.tsx
 * @description Variables tab content. Surfaces "Detected Variables"
 *              (those already used in the current template) at the top
 *              and the canonical "Common Variables" library below,
 *              filtered by the parent's search term.
 * @component VariablesTab
 * @layer infrastructure
 */

import { Plus } from "lucide-react";
import { Badge, Button, Separator } from "@packages/ui";
import type { TemplateVariable } from "@/lib/templates/templateEngine";
import type { VariableGroup } from "./data";

interface VariablesTabProps {
  detectedVariables: TemplateVariable[];
  filteredGroups: VariableGroup[];
  onInsertVariable: (variableName: string) => void;
}

export function VariablesTab({
  detectedVariables,
  filteredGroups,
  onInsertVariable,
}: VariablesTabProps) {
  return (
    <div className="space-y-4">
      {detectedVariables.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Detected Variables</h4>
          <div className="space-y-1">
            {detectedVariables.map((variable, index) => (
              <Button
                key={index}
                variant="outline"
                size="sm"
                onClick={() => onInsertVariable(variable.name)}
                className="w-full justify-between text-xs"
              >
                <span>{`{{${variable.name}}}`}</span>
                <Badge variant="secondary" className="text-xs">
                  {variable.type}
                </Badge>
              </Button>
            ))}
          </div>
          <Separator />
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">Common Variables</h4>
        {filteredGroups.map((group, groupIndex) => {
          const Icon = group.Icon;
          return (
            <div key={groupIndex} className="space-y-2">
              <div className="flex items-center space-x-2">
                <Icon className="h-4 w-4" />
                <span className="text-xs font-medium">{group.name}</span>
              </div>
              <div className="grid grid-cols-1 gap-1">
                {group.variables.map((variable, varIndex) => (
                  <Button
                    key={varIndex}
                    variant="ghost"
                    size="sm"
                    onClick={() => onInsertVariable(variable)}
                    className="justify-start text-xs font-mono"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {variable}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
