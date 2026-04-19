import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tenantId = "d0d97eca-5384-4f35-a970-db7031c188b0";
const outputDir = "apps/site/public/media/source/demo-rugs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function run() {
  mkdirSync(outputDir, { recursive: true });

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const supabaseSecret = requiredEnv("SUPABASE_SECRET_KEY");
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { persistSession: false },
  });

  const { data: rugs, error } = await supabase
    .from("rugs")
    .select(
      "id, intake_label, ai_description, stock_id, width_total_in, length_total_in, ai_structured_fields"
    )
    .eq("tenant_id", tenantId)
    .eq("status", "available")
    .eq("enrichment_status", "ready")
    .limit(12);

  if (error) throw error;

  const rugIds = rugs.map((rug) => rug.id);
  const { data: images, error: imageError } = await supabase
    .from("rug_images")
    .select("rug_id, path")
    .eq("tenant_id", tenantId)
    .in("rug_id", rugIds);

  if (imageError) throw imageError;

  const imageByRug = new Map(images.map((row) => [row.rug_id, row.path]));
  const manifest = [];

  for (const rug of rugs) {
    const storagePath = imageByRug.get(rug.id);
    if (!storagePath) continue;

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/rug-images/${storagePath}`;
    const response = await fetch(publicUrl);
    if (!response.ok) continue;

    const filename = `${rug.id}.jpg`;
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(join(outputDir, filename), buffer);
    manifest.push({
      ...rug,
      publicUrl,
      localFile: filename,
    });
  }

  writeFileSync(join(outputDir, "metadata.json"), JSON.stringify(manifest, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
