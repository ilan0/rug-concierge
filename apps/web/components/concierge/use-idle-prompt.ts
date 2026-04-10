"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createIdleController, IDLE_TIMEOUT_MS } from "@/lib/concierge/idle-controller";

export type ConciergeViewMode = "attract_mode" | "active_chat";

type UseIdlePromptOptions = {
  hasMessages: boolean;
};

export function useIdlePrompt(options: UseIdlePromptOptions) {
  const [viewMode, setViewMode] = useState<ConciergeViewMode>("attract_mode");
  const [showIdlePrompt, setShowIdlePrompt] = useState(false);
  const controllerRef = useRef<ReturnType<typeof createIdleController> | null>(null);
  const hasMessagesRef = useRef(options.hasMessages);

  useEffect(() => {
    hasMessagesRef.current = options.hasMessages;
  }, [options.hasMessages]);

  useEffect(() => {
    controllerRef.current = createIdleController({
      onIdle: () => {
        if (!hasMessagesRef.current) {
          setShowIdlePrompt(false);
          setViewMode("attract_mode");
          controllerRef.current?.stop();
          return;
        }
        setShowIdlePrompt((current) => (current ? current : true));
      },
      timeoutMs: IDLE_TIMEOUT_MS,
      setTimer: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
      clearTimer: (handle) => window.clearTimeout(handle),
    });
    return () => {
      controllerRef.current?.stop();
      controllerRef.current = null;
    };
  }, []);

  const startActiveChat = useCallback(() => {
    setViewMode("active_chat");
    setShowIdlePrompt(false);
  }, []);

  const returnToAttractMode = useCallback(() => {
    setShowIdlePrompt(false);
    setViewMode("attract_mode");
    controllerRef.current?.stop();
  }, []);

  const continueChat = useCallback(() => {
    if (viewMode !== "active_chat") return;
    setShowIdlePrompt(false);
    controllerRef.current?.markActivity();
  }, [viewMode]);

  const registerActivity = useCallback(() => {
    if (viewMode !== "active_chat") return;
    if (showIdlePrompt) return;
    controllerRef.current?.markActivity();
  }, [showIdlePrompt, viewMode]);

  useEffect(() => {
    if (viewMode !== "active_chat") {
      controllerRef.current?.stop();
      return;
    }

    controllerRef.current?.start();

    const onActivity = () => {
      if (showIdlePrompt) return;
      controllerRef.current?.markActivity();
    };

    const options = { passive: true, capture: true } as const;
    window.addEventListener("pointerdown", onActivity, options);
    window.addEventListener("keydown", onActivity, { capture: true });
    window.addEventListener("scroll", onActivity, options);
    window.addEventListener("wheel", onActivity, options);
    window.addEventListener("touchmove", onActivity, options);

    return () => {
      controllerRef.current?.stop();
      window.removeEventListener("pointerdown", onActivity, options);
      window.removeEventListener("keydown", onActivity, { capture: true });
      window.removeEventListener("scroll", onActivity, options);
      window.removeEventListener("wheel", onActivity, options);
      window.removeEventListener("touchmove", onActivity, options);
    };
  }, [showIdlePrompt, viewMode]);

  return {
    viewMode,
    showIdlePrompt,
    startActiveChat,
    returnToAttractMode,
    continueChat,
    registerActivity,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
  };
}
