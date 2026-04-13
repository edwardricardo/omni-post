import { useEffect, useRef } from "react";

/**
 * @hook useFocusTrap
 * @description Traps keyboard focus within a container element (e.g., modal, dialog).
 *              Prevents Tab key from moving focus outside the container.
 *              WCAG 2.1 Success Criterion 2.4.3 (Level A).
 * @param isActive - Whether the focus trap is active
 * @returns Ref to attach to the container element
 *
 * @example
 * const modalRef = useFocusTrap(isModalOpen);
 *
 * <div ref={modalRef} role="dialog">
 *   {/* Modal content *}
 * </div>
 */

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(isActive: boolean) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element when trap activates
    firstElement?.focus();

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;

      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener("keydown", handleTabKey);

    return () => {
      container.removeEventListener("keydown", handleTabKey);
    };
  }, [isActive]);

  return containerRef;
}
