/**
 * @file VersionCompareView.tsx
 * @description Side-by-side comparison tab for ContentVersioning showing two selected versions
 *              and a word-level diff below. All state comes from the parent orchestrator.
 * @component VersionCompareView
 * @layer infrastructure
 */

"use client";

import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { ScrollArea } from "../scroll-area";
import type { ContentVersion } from "./contentVersioningTypes";
import { getTextContent, getAuthorName, computeWordDiff } from "./contentVersioningTypes";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VersionCompareViewProps {
  from: ContentVersion;
  to: ContentVersion;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionCompareView({ from, to }: VersionCompareViewProps) {
  const fromText = getTextContent(from);
  const toText = getTextContent(to);
  const diffTokens = computeWordDiff(fromText, toText);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version {from.version}</CardTitle>
            <div className="text-sm text-muted-foreground">
              {getAuthorName(from)} &bull; {format(new Date(from.createdAt), "MMM d, yyyy")}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <p className="text-sm whitespace-pre-wrap">{fromText}</p>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Version {to.version}</CardTitle>
            <div className="text-sm text-muted-foreground">
              {getAuthorName(to)} &bull; {format(new Date(to.createdAt), "MMM d, yyyy")}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <p className="text-sm whitespace-pre-wrap">{toText}</p>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Diff View */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-32">
            <div className="text-sm space-x-1">
              {diffTokens.map((token, index) => (
                <span
                  key={index}
                  className={
                    token.type === "added"
                      ? "bg-green-100 text-green-800 px-1 rounded-sm"
                      : token.type === "removed"
                        ? "bg-red-100 text-red-800 px-1 rounded-sm line-through"
                        : ""
                  }
                >
                  {token.text}
                </span>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
