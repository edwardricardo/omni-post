/**
 * @file ContextTab.tsx
 * @description Context tab — sandbox key/value editor that drives the
 *              live template render preview. Top card adds new
 *              variables; bottom list edits / removes existing ones.
 * @component ContextTab
 * @layer infrastructure
 */

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Card, Input } from "@packages/ui";
import type { TemplateContext } from "@/lib/templates/templateEngine";

interface ContextTabProps {
  context: TemplateContext;
  onAdd: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onUpdate: (key: string, value: string) => void;
}

export function ContextTab({ context, onAdd, onRemove, onUpdate }: ContextTabProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    onAdd(newKey, newValue);
    setNewKey("");
    setNewValue("");
  };

  const entries = Object.entries(context);

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Add Context Variable</h4>
          <div className="flex space-x-2">
            <Input
              placeholder="Variable name"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="text-xs"
            />
            <Input
              placeholder="Value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="text-xs"
            />
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!newKey.trim() || !newValue.trim()}
            className="w-full text-xs"
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Variable
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">Current Context</h4>
        {entries.length > 0 ? (
          <div className="space-y-2">
            {entries.map(([key, value]) => (
              <Card key={key} className="p-2">
                <div className="flex items-center justify-between space-x-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium font-mono truncate">{key}</div>
                    <Input
                      value={String(value || "")}
                      onChange={(e) => onUpdate(key, e.target.value)}
                      className="text-xs mt-1"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(key)}
                    className="h-6 w-6 p-0 shrink-0"
                    aria-label={`Remove context variable ${key}`}
                  >
                    <X aria-hidden="true" className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">
            No context variables set. Add some above to see them here.
          </p>
        )}
      </div>
    </div>
  );
}
