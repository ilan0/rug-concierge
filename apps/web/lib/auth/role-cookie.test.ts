import test from "node:test";
import assert from "node:assert/strict";
import {
  createSignedRoleCookieValue,
  verifySignedRoleCookieValue,
} from "./role-cookie";

const TEST_SECRET = "0123456789abcdef0123456789abcdef";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function withTestSecret(fn: () => void): void {
  const previous = process.env.COOKIE_SECRET;
  process.env.COOKIE_SECRET = TEST_SECRET;
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.COOKIE_SECRET;
    } else {
      process.env.COOKIE_SECRET = previous;
    }
  }
}

test("signed role cookie verifies successfully", () => {
  withTestSecret(() => {
    const cookie = createSignedRoleCookieValue("store_staff", TENANT_A);
    const role = verifySignedRoleCookieValue({
      rawCookieValue: cookie,
      tenantId: TENANT_A,
    });
    assert.equal(role, "store_staff");
  });
});

test("tampered role fails verification", () => {
  withTestSecret(() => {
    const cookie = createSignedRoleCookieValue("store_staff", TENANT_A);
    const [, signature] = cookie.split(".");
    const tampered = `developer.${signature}`;
    const role = verifySignedRoleCookieValue({
      rawCookieValue: tampered,
      tenantId: TENANT_A,
    });
    assert.equal(role, null);
  });
});

test("tampered signature fails verification", () => {
  withTestSecret(() => {
    const cookie = createSignedRoleCookieValue("store_staff", TENANT_A);
    const [rolePart] = cookie.split(".");
    const tampered = `${rolePart}.deadbeef`;
    const role = verifySignedRoleCookieValue({
      rawCookieValue: tampered,
      tenantId: TENANT_A,
    });
    assert.equal(role, null);
  });
});

test("tenant mismatch fails verification", () => {
  withTestSecret(() => {
    const cookie = createSignedRoleCookieValue("store_staff", TENANT_A);
    const role = verifySignedRoleCookieValue({
      rawCookieValue: cookie,
      tenantId: TENANT_B,
    });
    assert.equal(role, null);
  });
});

test("unsigned legacy cookie format is rejected", () => {
  withTestSecret(() => {
    const role = verifySignedRoleCookieValue({
      rawCookieValue: "store_staff",
      tenantId: TENANT_A,
    });
    assert.equal(role, null);
  });
});

test("cookie with only separator is rejected", () => {
  withTestSecret(() => {
    const role = verifySignedRoleCookieValue({
      rawCookieValue: ".",
      tenantId: TENANT_A,
    });
    assert.equal(role, null);
  });
});

test("empty role never verifies as valid app role", () => {
  withTestSecret(() => {
    const cookie = createSignedRoleCookieValue(
      "" as unknown as "retail_customer",
      TENANT_A
    );
    const role = verifySignedRoleCookieValue({
      rawCookieValue: cookie,
      tenantId: TENANT_A,
    });
    assert.equal(role, null);
  });
});
