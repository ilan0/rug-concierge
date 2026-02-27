#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";

const mode = (process.argv[2] ?? "functional").toLowerCase();
const modeArgs = process.argv.slice(3);
const VALID_MODES = new Set(["functional", "quality"]);
const tenantId = (process.env.TENANT_ID ?? "").trim();
const port = 3100;
const baseUrl = `http://127.0.0.1:${port}`;
const FUNCTIONAL_OUTPUT = "scripts/testing/functionality/latest-functional.md";
const QUALITY_OUTPUT = "scripts/testing/quality/latest-quality.md";

function usage(message = "") {
  if (message) console.error(message);
  console.error("Usage:");
  console.error("  TENANT_ID=<uuid> npm run qa:functional");
  console.error("  TENANT_ID=<uuid> npm run qa:quality");
  console.error("  TENANT_ID=<uuid> npm run qa:all");
  console.error("Notes:");
  console.error("  Requires TENANT_ID env var.");
  process.exit(1);
}

function majorNodeVersion() {
  return Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
}

function runCommand(name, command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    child.on("close", (code) => {
      resolve({ name, ok: code === 0, code: code ?? 1 });
    });
  });
}

async function waitForServerReady(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status >= 200 && response.status < 500) return true;
    } catch {
      // wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function startServer() {
  const child = spawn("npm", ["--workspace", "apps/web", "run", "start"], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      QA_MODE: "1",
      TENANT_ID: tenantId,
    },
    stdio: "inherit",
  });

  const ready = await waitForServerReady(baseUrl);
  if (!ready) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise((r) => setTimeout(r, 3000))]);
    }
    return null;
  }

  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((r) => setTimeout(r, 5000))]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function runFunctional() {
  const lint = await runCommand("lint", "npm", ["run", "lint"], {
    TENANT_ID: tenantId,
    QA_MODE: "1",
  });
  if (!lint.ok) return lint.code;

  const build = await runCommand("build", "npm", ["run", "build"], {
    TENANT_ID: tenantId,
    QA_MODE: "1",
  });
  if (!build.ok) return build.code;

  const server = await startServer();
  if (!server) {
    console.error(`Failed to start server at ${baseUrl}`);
    return 1;
  }

  try {
    const check = await runCommand(
      "api-check",
      "node",
      ["scripts/testing/functionality/api-check.mjs", "--base-url", baseUrl],
      {
        TENANT_ID: tenantId,
        QA_MODE: "1",
      }
    );
    return check.ok ? 0 : check.code;
  } finally {
    await stopServer(server);
  }
}

async function runQuality() {
  const extended = modeArgs.includes("--extended");
  const server = await startServer();
  if (!server) {
    console.error(`Failed to start server at ${baseUrl}`);
    return 1;
  }

  try {
    const check = await runCommand(
      "chat-check",
      "node",
      [
        "scripts/testing/quality/chat-check.mjs",
        "--base-url",
        baseUrl,
        "--cases",
        "scripts/testing/quality/chat-check.ndjson",
        ...(extended ? ["--extended"] : []),
      ],
      {
        TENANT_ID: tenantId,
        QA_MODE: "1",
      }
    );
    return check.ok ? 0 : check.code;
  } finally {
    await stopServer(server);
  }
}

async function main() {
  if (!VALID_MODES.has(mode)) {
    usage(`Invalid mode: ${mode}`);
  }

  if (!Number.isFinite(majorNodeVersion()) || majorNodeVersion() < 20) {
    usage(`Node.js >= 20 is required. Current: ${process.versions.node}`);
  }

  if (!tenantId) {
    usage("Missing TENANT_ID.");
  }

  console.log(`QA mode: ${mode}`);
  if (mode === "quality" && modeArgs.includes("--extended")) {
    console.log("Quality scope: extended");
  }
  console.log(`Base URL: ${baseUrl}`);
  console.log(`TENANT_ID: ${tenantId}`);

  const code = mode === "quality" ? await runQuality() : await runFunctional();
  const outputPath = mode === "quality" ? QUALITY_OUTPUT : FUNCTIONAL_OUTPUT;
  console.log(`Output: ${outputPath}`);
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
