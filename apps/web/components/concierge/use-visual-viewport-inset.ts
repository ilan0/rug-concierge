"use client";

import { useEffect, useState } from "react";

function hasEditableFocus(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  if (!active) return false;
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) {
    return !active.readOnly && !active.disabled;
  }
  return active instanceof HTMLElement && active.isContentEditable;
}

function measureInset(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  if (!hasEditableFocus()) return 0;
  if (viewport.scale !== 1) return 0;

  const layoutHeight = document.documentElement?.clientHeight || window.innerHeight;
  const inset = layoutHeight - (viewport.height + viewport.offsetTop);
  const normalized = Math.max(0, Math.round(inset));
  return normalized < 60 ? 0 : normalized;
}

export function useVisualViewportInset() {
  const [bottomInsetPx, setBottomInsetPx] = useState(() => measureInset());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    const onChange = () => {
      setBottomInsetPx(measureInset());
    };

    const frame = window.requestAnimationFrame(onChange);
    viewport.addEventListener("resize", onChange);
    viewport.addEventListener("scroll", onChange);
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    document.addEventListener("focusin", onChange);
    document.addEventListener("focusout", onChange);

    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", onChange);
      viewport.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      document.removeEventListener("focusin", onChange);
      document.removeEventListener("focusout", onChange);
    };
  }, []);

  return bottomInsetPx;
}
