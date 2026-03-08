"use client";

/**
 * @file TemplateLibraryDialogs.tsx
 * @description Dialog components for the TemplateLibrary: template preview dialog
 * and delete confirmation alert dialog.
 */

import React from "react";
import { Card, CardContent } from "@packages/ui";
import { Button } from "@packages/ui";
import { Badge } from "@packages/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@packages/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@packages/ui";
import { Copy } from "lucide-react";
import type { TemplateLibraryDialogsProps } from "./templateLibraryTypes";

export function TemplateLibraryDialogs({
  previewOpen,
  deleteConfirmOpen,
  selectedTemplate,
  templateToDelete,
  onPreviewClose,
  onDeleteConfirmClose,
  onUseTemplate,
  onCopyTemplate,
  onConfirmDelete,
}: TemplateLibraryDialogsProps) {
  return (
    <>
      {/* Template Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={onPreviewClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTemplate?.name}</DialogTitle>
            <DialogDescription>{selectedTemplate?.description}</DialogDescription>
          </DialogHeader>
          {selectedTemplate && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{selectedTemplate.category}</Badge>
                {selectedTemplate.platforms.map((platform) => (
                  <Badge key={platform} variant="secondary">
                    {platform.toUpperCase()}
                  </Badge>
                ))}
              </div>
              <Card>
                <CardContent className="p-4">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                    {selectedTemplate.content}
                  </pre>
                </CardContent>
              </Card>
              <div className="flex space-x-2">
                <Button
                  onClick={() => {
                    onUseTemplate(selectedTemplate);
                    onPreviewClose(false);
                  }}
                  className="flex-1"
                >
                  Use This Template
                </Button>
                <Button variant="outline" onClick={() => onCopyTemplate(selectedTemplate)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={onDeleteConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{templateToDelete?.name}&quot;? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
