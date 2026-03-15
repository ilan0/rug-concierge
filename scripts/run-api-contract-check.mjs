#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const requiredEnv = ["BASE_URL", "TENANT_ID", "STORE_PASSCODE"];
const missing = requiredEnv.filter(
  (name) => !(process.env[name] ?? "").trim()
);
const isStrict =
  process.env.CI === "true" || process.env.REQUIRE_API_CONTRACT_CHECK === "1";

if (missing.length > 0) {
  const message = `[api-contracts] Missing required env: ${missing.join(", ")}`;
  if (isStrict) {
    console.error(message);
    process.exit(1);
  }

  console.log(`${message}. Skipping check in non-strict mode.`);
  process.exit(0);
}

const result = spawnSync("npx", ["tsx", "scripts/verify-api-contracts.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NON_DESTRUCTIVE: process.env.NON_DESTRUCTIVE?.trim() || "1",
  },
});

process.exit(result.status ?? 1);
