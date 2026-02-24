"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { fetchChatDebugTrace, sendChatTurn } from "@/lib/concierge/client";
import type { UiChatRequest, UiRole } from "@/lib/types/chat-ui";
import {
  getUiRole,
  getUiTenantId,
  setUiRole,
  syncUiSession,
} from "@/lib/ui/role-session";
import { UI_ROLES } from "@/lib/ui/roles";
import {
  DEFAULT_TRADE_SUPPORT_CONTEXT,
  type TradeSupportDraftContext,
} from "@/lib/types/trade-ui";
import { canRoleReadDebugTrace, canRoleUseReviewControls } from "@/lib/auth/policy";
import {
  STARTER_PROMPTS,
  summarizeTracePayload,
  toRoomId,
  toSlug,
} from "@/components/concierge/utils";
import type {
  ConciergeVariant,
  OperatorView,
  Turn,
  UiReviewState,
} from "@/components/concierge/types";

type UseConciergeControllerInput = {
  debug: boolean;
  variant: ConciergeVariant;
  tenantId: string;
};

export function useConciergeController(input: UseConciergeControllerInput) {
  const { debug, variant, tenantId } = input;

  const [role, setRole] = useState<UiRole>(
    variant === "trade" ? "trade_client" : "retail_customer"
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<UiReviewState | null>(null);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [operatorView, setOperatorView] = useState<OperatorView>("review");
  const [overrideMessage, setOverrideMessage] = useState("");
  const [overrideRugIds, setOverrideRugIds] = useState("");
  const [overrideNotes, setOverrideNotes] = useState("");
  const [tradeContext, setTradeContext] = useState<TradeSupportDraftContext>(
    DEFAULT_TRADE_SUPPORT_CONTEXT
  );
  const [showSlowNotice, setShowSlowNotice] = useState(false);

  const roleSwitcherVisible =
    process.env.NEXT_PUBLIC_ENABLE_ROLE_SWITCHER === "1" ||
    process.env.NODE_ENV !== "production";

  useEffect(() => {
    const storedRole = getUiRole();
    if (!storedRole) return;
    if (variant === "trade") {
      if (
        storedRole === "trade_client" ||
        storedRole === "store_staff" ||
        storedRole === "developer"
      ) {
        setRole(storedRole);
      }
      return;
    }
    setRole(storedRole);
  }, [variant]);

  useEffect(() => {
    if (!isLoading) {
      setShowSlowNotice(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowSlowNotice(true), 8000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  const debugRunId = useMemo(
    () => toSlug(`concierge-debug-${new Date().toISOString().replace(/[:.]/g, "-")}`),
    []
  );

  const canSubmit = useMemo(
    () => message.trim().length > 0 && !isLoading,
    [message, isLoading]
  );

  const starterPrompts = STARTER_PROMPTS[variant];
  const roleOptions = useMemo(
    () =>
      variant === "trade"
        ? UI_ROLES.filter(
            (candidate) =>
              candidate === "trade_client" ||
              candidate === "store_staff" ||
              candidate === "developer"
          )
        : UI_ROLES,
    [variant]
  );

  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;
  const latestAssistantMode = [...turns]
    .reverse()
    .find((turn) => turn.role === "assistant")?.responseMode;

  const canUseDebugTrace = canRoleReadDebugTrace(role);
  const canUseReviewRoleControls = canRoleUseReviewControls(role) && Boolean(sessionId);
  const isRecommendationContext = latestAssistantMode === "recommendation";
  const canUseReviewControls = canUseReviewRoleControls && isRecommendationContext;
  const canOpenOperator = canUseDebugTrace || canUseReviewRoleControls;

  useEffect(() => {
    if (!canOpenOperator && operatorOpen) {
      setOperatorOpen(false);
      return;
    }
    if (operatorView === "debug" && !canUseDebugTrace) {
      setOperatorView("review");
    }
    if (operatorView === "review" && !canUseReviewRoleControls && canUseDebugTrace) {
      setOperatorView("debug");
    }
  }, [canOpenOperator, canUseDebugTrace, canUseReviewRoleControls, operatorOpen, operatorView]);

  const onTradeContextField =
    (field: keyof TradeSupportDraftContext) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setTradeContext((prev) => ({
        ...prev,
        [field]: event.target.value,
      }));
    };

  const onRoleChange = async (nextRole: UiRole) => {
    setRole(nextRole);
    setUiRole(nextRole);
    try {
      await syncUiSession({
        role: nextRole,
        tenant_id: getUiTenantId() ?? tenantId,
      });
    } catch {
      // Keep chat usable even if cookie sync fails.
    }
  };

  const buildChatRequestPayload = (
    userMessage: string,
    activeRole: UiRole
  ): UiChatRequest => {
    const payload: UiChatRequest = {
      session_id: sessionId ?? undefined,
      role: activeRole,
      message: userMessage,
      tenant_id: getUiTenantId() ?? tenantId,
    };

    if (variant !== "trade") {
      return payload;
    }

    payload.tenant_id = tradeContext.tenant_id.trim() || payload.tenant_id;
    if (tradeContext.trade_client_id.trim()) {
      payload.trade_client_id = tradeContext.trade_client_id.trim();
    }

    const preferences: Record<string, unknown> = {};
    if (tradeContext.preferred_styles.trim()) {
      preferences.preferred_styles = tradeContext.preferred_styles
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (tradeContext.preferred_palette.trim()) {
      preferences.preferred_palette = tradeContext.preferred_palette
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (tradeContext.notes.trim()) {
      preferences.notes = tradeContext.notes.trim();
    }
    if (Object.keys(preferences).length > 0) {
      payload.trade_preferences = preferences;
    }

    const budgetMax = Number(tradeContext.budget_max.trim());
    if (
      tradeContext.budget_max.trim() &&
      Number.isFinite(budgetMax) &&
      budgetMax >= 0
    ) {
      payload.constraints = {
        budgetMax,
      };
    }

    const roomId = toRoomId(tradeContext.active_room);
    if (tradeContext.project_name.trim() || roomId) {
      payload.project_context = {
        name: tradeContext.project_name.trim() || null,
        active_room_id: roomId || null,
      };
    }

    return payload;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userMessage = message.trim();
    if (!userMessage) return;

    setError(null);
    setIsLoading(true);
    setMessage("");

    const debugCaseId =
      debug && canUseDebugTrace
        ? toSlug(`turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
        : null;

    const userTurn: Turn = {
      id: crypto.randomUUID(),
      role: "user",
      text: userMessage,
      createdAt: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, userTurn]);

    try {
      const { payload, headers } = await sendChatTurn(
        buildChatRequestPayload(userMessage, role),
        debug && canUseDebugTrace && debugCaseId
          ? {
              debugTrace: {
                runId: debugRunId,
                caseId: debugCaseId,
              },
            }
          : undefined
      );

      setSessionId(payload.session_id);

      let debugMeta: Turn["debug"] = null;
      if (debug && canUseDebugTrace && debugCaseId) {
        try {
          const tracePayload = await fetchChatDebugTrace(debugRunId, debugCaseId);
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: summarizeTracePayload(tracePayload),
            traceError: null,
          };
        } catch (traceError) {
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: null,
            traceError:
              traceError instanceof Error
                ? traceError.message
                : "Failed to load trace payload.",
          };
        }
      }

      const response = payload.response;
      setReviewState(payload.review_state ?? null);
      const assistantTurn: Turn = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: response.assistant_message,
        responseMode: payload.mode,
        recommendations:
          "recommendations" in response ? response.recommendations : undefined,
        questions: "questions" in response ? response.questions : undefined,
        createdAt: new Date().toISOString(),
        debug: debugMeta,
      };

      setTurns((prev) => [...prev, assistantTurn]);
      setSelectedTurnId(assistantTurn.id);
    } catch (nextError) {
      const details =
        nextError instanceof Error ? nextError.message : "Failed to send message.";
      setError(details);
    } finally {
      setIsLoading(false);
    }
  };

  const onReset = () => {
    setSessionId(null);
    setTurns([]);
    setMessage("");
    setError(null);
    setSelectedTurnId(null);
    setReviewState(null);
    setOverrideMessage("");
    setOverrideRugIds("");
    setOverrideNotes("");
    if (variant === "trade") {
      setTradeContext(DEFAULT_TRADE_SUPPORT_CONTEXT);
    }
  };

  const onReviewAction = async (
    action: "approve" | "reject" | "regenerate" | "override"
  ) => {
    if (!sessionId) return;
    if (!isRecommendationContext) {
      setError("Review actions are available after a recommendation response.");
      return;
    }
    if (action === "override" && !overrideMessage.trim() && !overrideRugIds.trim()) {
      setError("Override needs a custom message or selected rug IDs.");
      return;
    }

    setError(null);
    setIsLoading(true);

    const userText =
      action === "approve"
        ? "Review action: approve recommendation set."
        : action === "reject"
          ? "Review action: reject recommendation set."
          : action === "regenerate"
            ? "Review action: regenerate recommendation set."
            : "Review action: override recommendation set.";

    setTurns((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: userText,
        createdAt: new Date().toISOString(),
      },
    ]);

    const debugCaseId =
      debug && canUseDebugTrace
        ? toSlug(`turn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
        : null;

    const overrideIds = overrideRugIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const payload: UiChatRequest = {
      session_id: sessionId,
      role,
      message: "",
      tenant_id: getUiTenantId() ?? tenantId,
      review_action: action,
      ...(action === "override"
        ? {
            override: {
              assistant_message: overrideMessage.trim() || undefined,
              selected_rug_ids: overrideIds.length > 0 ? overrideIds : undefined,
              notes: overrideNotes.trim() || undefined,
            },
          }
        : {}),
    };

    try {
      const { payload: responsePayload, headers } = await sendChatTurn(
        payload,
        debug && debugCaseId
          ? {
              debugTrace: {
                runId: debugRunId,
                caseId: debugCaseId,
              },
            }
          : undefined
      );

      setSessionId(responsePayload.session_id);
      setReviewState(responsePayload.review_state ?? null);

      let debugMeta: Turn["debug"] = null;
      if (debug && canUseDebugTrace && debugCaseId) {
        try {
          const tracePayload = await fetchChatDebugTrace(debugRunId, debugCaseId);
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: summarizeTracePayload(tracePayload),
            traceError: null,
          };
        } catch (traceError) {
          debugMeta = {
            runId: debugRunId,
            caseId: debugCaseId,
            routeTraceId: headers.chatRouteTraceId,
            trace: null,
            traceError:
              traceError instanceof Error
                ? traceError.message
                : "Failed to load trace payload.",
          };
        }
      }

      const assistant = responsePayload.response;
      const assistantTurn: Turn = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: assistant.assistant_message,
        responseMode: responsePayload.mode,
        recommendations:
          "recommendations" in assistant ? assistant.recommendations : undefined,
        questions: "questions" in assistant ? assistant.questions : undefined,
        createdAt: new Date().toISOString(),
        debug: debugMeta,
      };
      setTurns((prev) => [...prev, assistantTurn]);
      setSelectedTurnId(assistantTurn.id);

      if (action === "override") {
        setOverrideMessage("");
        setOverrideRugIds("");
        setOverrideNotes("");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Review action failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return {
    role,
    roleOptions,
    roleSwitcherVisible,
    sessionId,
    message,
    setMessage,
    turns,
    isLoading,
    error,
    selectedTurn,
    selectedTurnId,
    setSelectedTurnId,
    reviewState,
    operatorOpen,
    setOperatorOpen,
    operatorView,
    setOperatorView,
    overrideMessage,
    setOverrideMessage,
    overrideRugIds,
    setOverrideRugIds,
    overrideNotes,
    setOverrideNotes,
    tradeContext,
    onTradeContextField,
    showSlowNotice,
    debugRunId,
    canSubmit,
    starterPrompts,
    latestAssistantMode,
    canUseDebugTrace,
    canUseReviewRoleControls,
    isRecommendationContext,
    canUseReviewControls,
    canOpenOperator,
    onRoleChange,
    onSubmit,
    onReset,
    onReviewAction,
    pushStarterPrompt: setMessage,
    effectiveTenantId: getUiTenantId() ?? tenantId,
  };
}
