const messages = [
  { role: "system", content: AI_SYSTEM_PROMPT },
  { role: "system", content: RECOMMENDATION_PROMPT_V1 },

  // Optional: trade context injected only if a trade client is selected/recognized
  { role: "system", content: TRADE_CLIENT_CONTEXT_BLOCK }, // preferences + notes (no secrets)

  { role: "system", content: INVENTORY_CONTEXT_BLOCK },           // hard-coded seed inventory (for now)
  { role: "system", content: STRUCTURED_OUTPUT_ADDON },           // JSON-only schema requirement
  { role: "user",   content: USER_MESSAGE }
];

// Optional: trade context
TRADE CLIENT CONTEXT (authoritative):
{
  "client_type": "designer",
  "display_name": "Maya Reynolds (Cedar & Linen Interiors)",
  "preferences": {
    "budget_band": [3500, 12000],
    "preferred_styles": ["oushak","khotan"],
    "preferred_palette": ["warm_neutral","muted"],
    "common_sizes": ["8x10","9x12"]
  }
}

const INVENTORY_CONTEXT_BLOCK = `
AVAILABLE INVENTORY (authoritative – recommend ONLY from this list):

${JSON.stringify(
  inventoryRows.map(rug => ({
    id: rug.id,
    sku: rug.sku,
    label: rug.intake_label,
    size: {
      width_ft: rug.width_ft,
      width_in: rug.width_in,
      length_ft: rug.length_ft,
      length_in: rug.length_in,
      width_total_in: rug.width_total_in,
      length_total_in: rug.length_total_in
    },
    price_usd: rug.price,
    style: rug.style,
    origin_country: rug.origin_country,
    condition: rug.condition,
    palette: rug.palette,
    pattern: rug.pattern,
    notes: rug.public_description ?? null
  })),
  null,
  2
)}




`;
You filter and normalize the fields you expose
	•	You prevent the AI from latching onto junk or internal fields
	•	You control what facts are allowed to appear in recommendations

This is not optional in production-quality AI systems.