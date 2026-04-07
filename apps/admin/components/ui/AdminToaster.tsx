/**
 * @file AdminToaster.tsx
 * @description Admin-specific Toaster that positions toasts at top-center.
 * Wraps @packages/ui Toast primitives with custom viewport positioning.
 * @layer presentation
 */
"use client";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  useToast,
} from "@packages/ui";

export function AdminToaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props}>
          <div className="grid gap-1">
            {title && <ToastTitle>{title}</ToastTitle>}
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport
        className="fixed flex flex-col gap-2 p-4"
        style={{
          top: "1rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 100,
          maxWidth: "420px",
          width: "100%",
        }}
      />
    </ToastProvider>
  );
}
