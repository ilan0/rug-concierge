#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";

const mode = (process.argv[2] ?? "functional").toLowerCase();
const modeArgs = process.argv.slice(3);
const VALID_MODES = new Set(["functional", "quality"]);
const tenantId = (process.env.TENANT_ID ?? "").trim();
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

async function findOpenPort() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(3100));
    server.listen({ port: 0 }, () => {
      const address = server.address();
      const resolvedPort =
        address && typeof address === "object" ? address.port : 3100;
      server.close(() => resolve(resolvedPort));
    });
  });
}

async function resolveQaPort() {
  return await findOpenPort();
}

async function startServer(port) {
  const baseUrl = `http://127.0.0.1:${port}`;
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

  return { child, baseUrl };
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
  if (!lint.ok) return { code: lint.code, baseUrl: null };

  const build = await runCommand("build", "npm", ["run", "build"], {
    TENANT_ID: tenantId,
    QA_MODE: "1",
  });
  if (!build.ok) return { code: build.code, baseUrl: null };

  const port = await resolveQaPort();
  const started = await startServer(port);
  if (!started) {
    const baseUrl = `http://127.0.0.1:${port}`;
    console.error(`Failed to start server at ${baseUrl}`);
    return { code: 1, baseUrl };
  }
  const { child, baseUrl } = started;

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
    if (!check.ok) return { code: check.code, baseUrl };

    const intake = await runCommand(
      "intake-suite",
      "node",
      [
        "scripts/testing/intake/run-intake-suite.mjs",
        "--base-url",
        baseUrl,
        "--run-id",
        `functional-intake-${Date.now()}`,
      ],
      {
        TENANT_ID: tenantId,
        QA_MODE: "1",
      }
    );
    return { code: intake.ok ? 0 : intake.code, baseUrl };
  } finally {
    await stopServer(child);
  }
}

async function runQuality() {
  const extended = modeArgs.includes("--extended");
  const port = await resolveQaPort();
  const started = await startServer(port);
  if (!started) {
    const baseUrl = `http://127.0.0.1:${port}`;
    console.error(`Failed to start server at ${baseUrl}`);
    return { code: 1, baseUrl };
  }
  const { child, baseUrl } = started;

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
    return { code: check.ok ? 0 : check.code, baseUrl };
  } finally {
    await stopServer(child);
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
  console.log(`TENANT_ID: ${tenantId}`);

  const result = mode === "quality" ? await runQuality() : await runFunctional();
  if (result.baseUrl) {
    console.log(`Base URL: ${result.baseUrl}`);
  }
  const outputPath = mode === "quality" ? QUALITY_OUTPUT : FUNCTIONAL_OUTPUT;
  console.log(`Output: ${outputPath}`);
  process.exit(result.code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
