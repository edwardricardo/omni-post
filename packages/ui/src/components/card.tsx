/**
 * @file card.tsx
 * @description Card primitives (Card, CardHeader, CardTitle, CardDescription, CardContent,
 *              CardFooter) for composing content panels with consistent padding and typography.
 * @component Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
 * @layer infrastructure
 */
import * as React from "react";

import { cn } from "../lib/utils";

const CardImpl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border bg-card text-card-foreground shadow-xs", className)}
      {...props}
    />
  )
);
CardImpl.displayName = "Card";

const Card = React.memo(CardImpl);

const CardHeaderImpl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeaderImpl.displayName = "CardHeader";

const CardHeader = React.memo(CardHeaderImpl);

const CardTitleImpl = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
    {...props}
  >
    {children}
  </h3>
));
CardTitleImpl.displayName = "CardTitle";

const CardTitle = React.memo(CardTitleImpl);

const CardDescriptionImpl = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescriptionImpl.displayName = "CardDescription";

const CardDescription = React.memo(CardDescriptionImpl);

const CardContentImpl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
CardContentImpl.displayName = "CardContent";

const CardContent = React.memo(CardContentImpl);

const CardFooterImpl = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
CardFooterImpl.displayName = "CardFooter";

const CardFooter = React.memo(CardFooterImpl);

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
