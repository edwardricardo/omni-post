/**
 * @file input.tsx
 * @description Styled Input component with forwarded ref, matching design system focus-ring and
 *              disabled-state styling.
 * @component Input
 * @layer infrastructure
 */
import * as React from "react";
import { cn } from "../lib/utils.js";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const InputImpl = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
InputImpl.displayName = "Input";

const Input = React.memo(InputImpl);

export { Input };
