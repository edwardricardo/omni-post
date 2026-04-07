# ChangePlanDialog Investigation Report

**Date:** 2026-04-04

---

## Root Cause

**Two missing CSS dependencies in admin app:**

1. **`tw-animate-css` not imported** — The animation library that provides `animate-in`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*` utilities required by Radix UI Dialog/AlertDialog components from `@packages/ui`.

2. **`@source` scanner fails to generate `bg-black/80`** — The `@source` directive for `packages/ui/src` resolves via pnpm workspace symlinks, and Tailwind v4's scanner does not detect all classes in those files. `bg-black/80` (used by DialogOverlay) was not generated.

**Effect:** The Dialog overlay renders as an invisible full-screen `position: fixed` element (no background color), blocking all mouse clicks. The Dialog content renders with correct background (`bg-background` = `var(--bg-surface)` via `@theme inline`) but without animation classes, the initial render state is broken in some browsers. The result: UI appears frozen with no visible dialog.

---

## Evidence

### Missing `tw-animate-css`

```
Client: apps/client/app/globals.css:2 → @import 'tw-animate-css';
Admin:  apps/admin/app/globals.css:1 → @import "tailwindcss"; (NO tw-animate-css)
```

### Missing classes in built CSS (BEFORE fix)

```
bg-black/80:  NOT FOUND
animate-in:   NOT FOUND
fade-in-0:    NOT FOUND
zoom-in-95:   NOT FOUND
slide-in-*:   NOT FOUND
```

Only `bg-black` and `bg-black/50` existed — `bg-black/50` was generated because `MfaManager.tsx` (admin's own component) uses it, NOT from `@packages/ui` scanning.

### `@source` scanning issue

The `@source "../../packages/ui/src/**/*.{ts,tsx}"` path resolves from the PostCSS root (`apps/admin/`), pointing correctly to `packages/ui/src/`. However, Tailwind v4's scanner does not reliably detect all classes in pnpm workspace-linked files. `bg-black/50` was only present because `apps/admin/components/security/MfaManager.tsx` uses it directly.

---

## Why Previous Fixes Failed

The `@theme inline` block added previously was **correct** and **working** — `bg-background` resolved to `var(--bg-surface)` in the built CSS. But:

1. The overlay (`DialogOverlay`) uses `bg-black/80`, not `bg-background` — so `@theme inline` didn't help the overlay
2. Without `tw-animate-css`, animation classes weren't generated — the Dialog's entry/exit transitions were broken
3. The `@custom-variant dark` directive was also missing (client has it, admin didn't)

---

## Fix Applied

### `apps/admin/package.json`

Added `"tw-animate-css": "1.4.0"` to dependencies.

### `apps/admin/app/globals.css`

```css
@import "tailwindcss";
@import "tw-animate-css"; /* NEW */

@custom-variant dark (&:is(.dark *)); /* NEW */

@source "../../packages/ui/src/**/*.{ts,tsx}";
@source "../components/**/*.{ts,tsx}";

/* Force-generate classes used by @packages/ui Dialog/AlertDialog */
@source inline("bg-black/80 bg-background/80 animate-in animate-out
  fade-in-0 fade-out-0 zoom-in-95 zoom-out-95
  slide-in-from-left-1/2 slide-in-from-top-[48%]
  slide-out-to-left-1/2 slide-out-to-top-[48%]");
```

### Built CSS verification (AFTER fix)

```
bg-black/80:  FOUND
animate-in:   FOUND
fade-in-0:    FOUND
zoom-in-95:   FOUND
```

---

## Verification

1. `pnpm build` → 0 errors, 9/9 tasks
2. In browser: Click "Edit Plan" on account billing panel → Dialog should show with dark overlay, visible content with Custom/Bundle tabs
3. Escape key closes dialog properly

---

## Build: 0 errors, 9/9 tasks
