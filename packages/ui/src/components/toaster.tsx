"use client";

/**
 * @file toaster.tsx
 * @description Toaster container component that renders active toasts from the useToast hook
 *              into a viewport-anchored provider. Maps the `destructive` variant to Radix
 *              `type="foreground"` (assertive announcement) and the default variant to
 *              `type="background"` (polite announcement) per Radix Toast a11y guidance:
 *              https://www.radix-ui.com/primitives/docs/components/toast#api-reference.
 * @component Toaster
 * @layer infrastructure
 */
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast.js";
import { useToast } from "./use-toast.js";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const ariaType = variant === "destructive" ? "foreground" : "background";
        return (
          <Toast key={id} variant={variant} type={ariaType} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose aria-label="Close notification" />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
