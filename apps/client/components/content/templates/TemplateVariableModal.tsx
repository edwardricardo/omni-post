"use client";

/**
 * @file TemplateVariableModal.tsx
 * @description Modal dialog for filling in variable placeholders in a content template
 * before applying it to a new post, with dynamic form fields per variable.
 */

import React, { useState, useEffect } from "react";
import type { ContentTemplate } from "./types";

interface TemplateVariableModalProps {
  template: ContentTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (templateId: string, variables: Record<string, any>) => void;
}

/**
 * @component TemplateVariableModal
 * @description Modal dialog for filling in variable placeholders in a content template
 * before applying it to a new post, with dynamic form fields per variable.
 */
export const TemplateVariableModal: React.FC<TemplateVariableModalProps> = ({
  template,
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [variables, setVariables] = useState<Record<string, any>>({});

  useEffect(() => {
    if (template) {
      const initialVariables: Record<string, any> = {};
      template.content.variables.forEach((variable) => {
        initialVariables[variable.name] = variable.defaultValue ?? "";
      });
      setVariables(initialVariables);
    }
  }, [template]);

  const handleSubmit = () => {
    if (template) {
      onSubmit(template.id, variables);
      setVariables({});
    }
  };

  if (!isOpen || !template) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Configure Template: {template.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="space-y-4 mb-6">
          {template.content.variables.map((variable) => (
            <div key={variable.name}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {variable.name} {variable.required && <span className="text-red-500">*</span>}
              </label>
              {variable.type === "text" ||
              variable.type === "hashtags" ||
              variable.type === "mentions" ? (
                <textarea
                  rows={variable.type === "text" ? 3 : 2}
                  value={variables[variable.name] ?? ""}
                  onChange={(e) =>
                    setVariables((prev) => ({
                      ...prev,
                      [variable.name]: e.target.value,
                    }))
                  }
                  placeholder={variable.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              ) : (
                <input
                  type={
                    variable.type === "url"
                      ? "url"
                      : variable.type === "date"
                        ? "date"
                        : variable.type === "number"
                          ? "number"
                          : "text"
                  }
                  value={variables[variable.name] ?? ""}
                  onChange={(e) =>
                    setVariables((prev) => ({
                      ...prev,
                      [variable.name]: e.target.value,
                    }))
                  }
                  placeholder={variable.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              )}
              <p className="text-xs text-gray-500 mt-1">{variable.placeholder}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Create Content
          </button>
        </div>
      </div>
    </div>
  );
};
