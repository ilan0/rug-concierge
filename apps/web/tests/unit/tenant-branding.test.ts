import test from "node:test";
import assert from "node:assert/strict";
import { readTenantBrandingFromSettings } from "../../lib/branding/tenant-branding";

test("readTenantBrandingFromSettings reads valid branding fields", () => {
  const parsed = readTenantBrandingFromSettings({
    branding: {
      store_name: "J&J Oriental Rug Gallery",
      logo_mark_url: "https://example.com/logo.png",
    },
  });

  assert.equal(parsed.storeName, "J&J Oriental Rug Gallery");
  assert.equal(parsed.storeLogoUrl, "https://example.com/logo.png");
});

test("readTenantBrandingFromSettings ignores invalid settings shape", () => {
  const parsed = readTenantBrandingFromSettings({
    branding: {
      store_name: "  ",
      logo_mark_url: "javascript:alert('xss')",
    },
  });

  assert.equal(parsed.storeName, null);
  assert.equal(parsed.storeLogoUrl, null);
});

test("readTenantBrandingFromSettings allows relative logo paths", () => {
  const parsed = readTenantBrandingFromSettings({
    branding: {
      store_name: "Store",
      logo_mark_url: "/branding/logo.png",
    },
  });

  assert.equal(parsed.storeName, "Store");
  assert.equal(parsed.storeLogoUrl, "/branding/logo.png");
});
