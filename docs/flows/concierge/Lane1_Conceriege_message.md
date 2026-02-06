const messages = [
  {
    role: "system",
    content: AI_SYSTEM_PROMPT
  },
  {
    role: "system",
    content: RECOMMENDATION_PROMPT_V1
  },
  {
    role: "system",
    content: INVENTORY_CONTEXT_BLOCK
  },
  {
    role: "user",
    content: USER_MESSAGE
  }
];

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