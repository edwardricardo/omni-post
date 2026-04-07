/**
 * @file ui-safelist.ts
 * @description Tailwind class safelist for @packages/ui components.
 *
 * The Tailwind v4 @source scanner cannot resolve classes from pnpm workspace
 * symlinked packages. This file ensures all classes used by Dialog, AlertDialog,
 * Toast, and Toaster from @packages/ui are detected and generated in the CSS.
 *
 * This file is never imported at runtime — it exists only for the Tailwind scanner
 * (referenced via @source in globals.css).
 */

// Dialog (packages/ui/src/components/dialog.tsx)
// DialogOverlay
export const _dialogOverlay =
  "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
// DialogContent
export const _dialogContent =
  "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg";
// DialogClose
export const _dialogClose =
  "absolute right-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground";
// DialogHeader, DialogFooter, DialogTitle, DialogDescription
export const _dialogParts =
  "flex flex-col space-y-1.5 text-center sm:text-left flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 text-lg font-semibold leading-none tracking-tight text-sm text-muted-foreground";

// AlertDialog (packages/ui/src/components/alert-dialog.tsx)
// AlertDialogOverlay
export const _alertOverlay =
  "fixed inset-0 z-50 bg-background/80 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
// AlertDialogContent (same positioning as Dialog)
export const _alertContent =
  "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg";
// AlertDialogHeader, Footer, Title, Description
export const _alertParts =
  "flex flex-col space-y-2 text-center sm:text-left flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 text-lg font-semibold text-sm text-muted-foreground mt-2 sm:mt-0";

// Toast (packages/ui/src/components/toast.tsx)
// ToastViewport
export const _toastViewport =
  "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]";
// Toast (default + destructive variants)
export const _toast =
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full";
// Toast variant classes
export const _toastDefault = "border bg-background text-foreground";
export const _toastDestructive =
  "destructive group border-destructive bg-destructive text-destructive-foreground";
// ToastAction
export const _toastAction =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive";
// ToastClose
export const _toastClose =
  "absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-hidden focus:ring-2 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600";
// ToastTitle, ToastDescription
export const _toastText = "text-sm font-semibold opacity-90";
