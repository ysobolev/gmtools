import { useEffect, useRef } from "react";

/** Dismiss only the topmost custom modal. Native dialogs handle their own cancel event. */
export function useModalEscape<T extends HTMLElement = HTMLElement>(open: boolean, busy: boolean, onClose: () => void) {
  const modalRef = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector("dialog[open]")) return;
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals.item(modals.length - 1) !== modalRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onClose]);
  return modalRef;
}
