"use client";

/**
 * @file submit-button.tsx
 * @description Form submit Button that uses React useFormStatus to show pending state and a
 *              spinner while a server action is in flight.
 * @component SubmitButton
 * @layer infrastructure
 */
import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { cn } from "../lib/utils";

export interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  /**
   * Button text or content to display when not loading
   */
  children: React.ReactNode;

  /**
   * Optional text to display while form is submitting
   * @default "Submitting..."
   */
  pendingText?: string;

  /**
   * Whether to show a loading spinner icon
   * @default true
   */
  showSpinner?: boolean;

  /**
   * Additional className for custom styling
   */
  className?: string;

  /**
   * Custom spinner icon (defaults to Loader2)
   */
  spinnerIcon?: React.ReactNode;

  /**
   * Spinner position relative to text
   * @default "left"
   */
  spinnerPosition?: "left" | "right";
}

/**
 * SubmitButton component that uses React 19's useFormStatus hook
 *
 * IMPORTANT: This component MUST be used as a child of a <form> element.
 * It cannot be used in the same component that renders the <form>.
 *
 * @example
 * // ✅ Correct usage - SubmitButton is a child of <form>
 * function MyForm() {
 *   return (
 *     <form action={myServerAction}>
 *       <input name="email" type="email" />
 *       <SubmitButton>Sign In</SubmitButton>
 *     </form>
 *   );
 * }
 *
 * @example
 * // ✅ Correct usage with custom pending text
 * <form action={myServerAction}>
 *   <input name="data" />
 *   <SubmitButton pendingText="Saving..." variant="secondary">
 *     Save Changes
 *   </SubmitButton>
 * </form>
 *
 * @example
 * // ❌ Incorrect usage - useFormStatus won't work
 * function MyForm() {
 *   const { pending } = useFormStatus(); // ERROR: Not inside form context
 *   return <form>...</form>;
 * }
 */
export const SubmitButton = React.forwardRef<HTMLButtonElement, SubmitButtonProps>(
  (
    {
      children,
      pendingText = "Submitting...",
      showSpinner = true,
      spinnerIcon,
      spinnerPosition = "left",
      className,
      disabled,
      ...props
    },
    ref
  ) => {
    const { pending } = useFormStatus();

    const spinner = spinnerIcon || <Loader2 className="h-4 w-4 animate-spin" />;

    return (
      <Button
        ref={ref}
        type="submit"
        disabled={pending || disabled}
        className={cn(className)}
        {...props}
      >
        {pending ? (
          <>
            {showSpinner && spinnerPosition === "left" && <span className="mr-2">{spinner}</span>}
            <span>{pendingText}</span>
            {showSpinner && spinnerPosition === "right" && <span className="ml-2">{spinner}</span>}
          </>
        ) : (
          children
        )}
      </Button>
    );
  }
);

SubmitButton.displayName = "SubmitButton";
