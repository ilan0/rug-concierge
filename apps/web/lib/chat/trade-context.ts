import type { SessionData, TradeContext } from "@/lib/chat/types";

type UpdateTradeContextInput = {
  role: SessionData["role"];
  tenantId: string | null;
  tradeClientId: string | null;
  tradePreferences?: Record<string, unknown>;
};

// PSEUDOCODE
// Build trade context each turn.
// Request-provided preferences override previous session values.
// Roles without trade support always get empty trade context.
export function updateTradeContextForTurn(
  session: SessionData,
  input: UpdateTradeContextInput
): SessionData {
  if (
    input.role !== "trade_client" &&
    input.role !== "store_staff" &&
    input.role !== "developer"
  ) {
    return {
      ...session,
      trade_context: {
        tenant_id: null,
        trade_client_id: null,
        preferences: {},
        preferences_source: "none",
      },
    };
  }

  const hasRequestPrefs =
    input.tradePreferences && Object.keys(input.tradePreferences).length > 0;
  const nextTradeContext: TradeContext = {
    tenant_id: input.tenantId ?? session.trade_context.tenant_id ?? null,
    trade_client_id:
      input.tradeClientId ?? session.trade_context.trade_client_id ?? null,
    preferences: hasRequestPrefs
      ? (input.tradePreferences as Record<string, unknown>)
      : session.trade_context.preferences,
    preferences_source: hasRequestPrefs ? "request" : "session",
  };

  return {
    ...session,
    trade_context: nextTradeContext,
  };
}
