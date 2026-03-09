import test from "node:test";
import assert from "node:assert/strict";
import { getCookieSecret } from "./deployment";
import { resolveAuthoritativeTenantForServer } from "./tenant";
import { resolveRoleFromInputs } from "./request-role";

const DEV_FALLBACK_COOKIE_SECRET = "dev-insecure-cookie-secret-change-me";
const ENV_KEYS = [
  "NODE_ENV",
  "COOKIE_SECRET",
  "DEPLOYMENT_TYPE",
  "TENANT_ID",
] as const;

function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void
): void {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }

  try {
    for (const key of ENV_KEYS) {
      if (!(key in values)) continue;
      const value = values[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = snapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("missing COOKIE_SECRET throws in production", () => {
  withEnv(
    {
      NODE_ENV: "production",
      DEPLOYMENT_TYPE: "developer",
      COOKIE_SECRET: undefined,
    },
    () => {
      assert.throws(() => getCookieSecret(), /Missing COOKIE_SECRET/);
    }
  );
});

test("missing COOKIE_SECRET falls back in development", () => {
  withEnv(
    {
      NODE_ENV: "development",
      DEPLOYMENT_TYPE: "developer",
      COOKIE_SECRET: undefined,
    },
    () => {
      assert.equal(getCookieSecret(), DEV_FALLBACK_COOKIE_SECRET);
    }
  );
});

test("customer deployment resolves env tenant over request tenant", () => {
  withEnv(
    {
      DEPLOYMENT_TYPE: "customer",
      TENANT_ID: "tenant-a",
    },
    () => {
      const tenantId = resolveAuthoritativeTenantForServer({
        requestTenantId: "tenant-b",
      });
      assert.equal(tenantId, "tenant-a");
    }
  );
});

test("developer deployment uses request tenant", () => {
  withEnv(
    {
      DEPLOYMENT_TYPE: "developer",
      TENANT_ID: undefined,
    },
    () => {
      const tenantId = resolveAuthoritativeTenantForServer({
        requestTenantId: "tenant-b",
      });
      assert.equal(tenantId, "tenant-b");
    }
  );
});

test("staff deployment without TENANT_ID throws", () => {
  withEnv(
    {
      DEPLOYMENT_TYPE: "staff",
      TENANT_ID: undefined,
    },
    () => {
      assert.throws(
        () =>
          resolveAuthoritativeTenantForServer({
            requestTenantId: "tenant-b",
          }),
        /TENANT_ID is required/
      );
    }
  );
});

test("customer deployment blocks non-retail request role without cookie", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "customer",
    cookieRole: null,
    requestRole: "trade_client",
  });
  assert.equal(result.role, "retail_customer");
  assert.equal(result.blocked_non_retail_request, true);
});

test("staff deployment blocks non-retail request role without cookie", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "staff",
    cookieRole: null,
    requestRole: "store_staff",
  });
  assert.equal(result.role, "retail_customer");
  assert.equal(result.blocked_non_retail_request, true);
});

test("non-developer deployment allows explicit retail_customer request role", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "customer",
    cookieRole: null,
    requestRole: "retail_customer",
  });
  assert.equal(result.role, "retail_customer");
  assert.equal(result.source, "request");
  assert.equal(result.blocked_non_retail_request, false);
});

test("customer deployment ignores non-retail cookie role", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "customer",
    cookieRole: "store_staff",
    requestRole: null,
  });
  assert.equal(result.role, "retail_customer");
  assert.equal(result.source, "default");
  assert.equal(result.cookie_role, null);
});

test("customer deployment allows trade cookie role", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "customer",
    cookieRole: "trade_client",
    requestRole: null,
  });
  assert.equal(result.role, "trade_client");
  assert.equal(result.source, "cookie");
  assert.equal(result.cookie_role, "trade_client");
});

test("customer deployment keeps mismatch when trade cookie conflicts with request role", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "customer",
    cookieRole: "trade_client",
    requestRole: "retail_customer",
  });
  assert.equal(result.role, "trade_client");
  assert.equal(result.source, "cookie");
  assert.equal(result.cookie_role, "trade_client");
  assert.equal(result.mismatch, true);
});

test("developer deployment allows non-retail request role without cookie", () => {
  const result = resolveRoleFromInputs({
    deploymentType: "developer",
    cookieRole: null,
    requestRole: "store_staff",
  });
  assert.equal(result.role, "store_staff");
  assert.equal(result.source, "request");
  assert.equal(result.blocked_non_retail_request, false);
});
