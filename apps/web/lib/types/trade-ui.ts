export type TradeSupportDraftContext = {
  tenant_id: string;
  trade_client_id: string;
  project_name: string;
  active_room: string;
  preferred_styles: string;
  preferred_palette: string;
  budget_max: string;
  notes: string;
};

export const DEFAULT_TRADE_SUPPORT_CONTEXT: TradeSupportDraftContext = {
  tenant_id: "",
  trade_client_id: "",
  project_name: "",
  active_room: "",
  preferred_styles: "",
  preferred_palette: "",
  budget_max: "",
  notes: "",
};
