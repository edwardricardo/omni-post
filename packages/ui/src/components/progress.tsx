"use client";

/**
 * @file progress.tsx
 * @description Progress bar component with a filled indicator driven by a numeric value prop.
 * @component Progress
 * @layer infrastructure
 */
import * as React from "react";
import { cn } from "../lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, "aria-label": ariaLabel = "Progress", ...props }, ref) => {
    const clampedValue = Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedValue}
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
        {...props}
      >
        <div
          className="h-full bg-primary transition-all duration-300 ease-in-out"
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
