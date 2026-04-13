/**
 * @file TabNav.tsx
 * @description Horizontal tab navigation bar with active indicator.
 *              Uses CSS custom-property tokens for theme support.
 * @layer presentation
 */
"use client";

import React, { useCallback } from "react";

interface Tab {
  key: string;
  label: string;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (key: string) => void;
}

/**
 * @component TabNav
 * @description Horizontal tab navigation bar with an active underline indicator and ARIA roles.
 * @param props.tabs - Array of tab definitions with key and label
 * @param props.activeTab - The key of the currently selected tab
 * @param props.onChange - Callback invoked with the key of the newly selected tab
 */
export function TabNav({ tabs, activeTab, onChange }: TabNavProps) {
  const handleClick = useCallback(
    (key: string) => {
      onChange(key);
    },
    [onChange]
  );

  return (
    <nav
      role="tablist"
      aria-label="Tabs"
      className="flex gap-1 border-b border-[var(--border-subtle)]"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.key}`}
            id={`tab-${tab.key}`}
            onClick={() => handleClick(tab.key)}
            className={[
              "cursor-pointer px-4 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
              isActive
                ? "border-b-2 border-[var(--accent)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
