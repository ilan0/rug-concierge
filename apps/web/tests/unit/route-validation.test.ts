import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  parseJsonBodyWithSchema,
  parseRouteParamsWithSchema,
  parseSearchParamsWithSchema,
} from "../../lib/http/route-validation";

test("parseJsonBodyWithSchema accepts valid payload", async () => {
  const schema = z.object({ name: z.string().min(1) }).strict();
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "valid" }),
  });

  const parsed = await parseJsonBodyWithSchema(request, schema);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.name, "valid");
  }
});

test("parseJsonBodyWithSchema returns 400 on invalid payload", async () => {
  const schema = z.object({ name: z.string().min(1) }).strict();
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "" }),
  });

  const parsed = await parseJsonBodyWithSchema(
    request,
    schema,
    "Invalid payload."
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.response.status, 400);
    const body = (await parsed.response.json()) as Record<string, unknown>;
    assert.equal(body.error, "Invalid payload.");
    assert.equal(body.code, "BAD_REQUEST");
  }
});

test("parseRouteParamsWithSchema validates route params", async () => {
  const schema = z.object({ id: z.string().uuid() }).strict();
  const valid = await parseRouteParamsWithSchema(
    Promise.resolve({ id: "a8be676e-5bfe-4692-8481-2dc7fc92ad0c" }),
    schema
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.id, "a8be676e-5bfe-4692-8481-2dc7fc92ad0c");
  }

  const invalid = await parseRouteParamsWithSchema(
    Promise.resolve({ id: "not-a-uuid" }),
    schema,
    "Invalid route params."
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.response.status, 400);
  }
});

test("parseSearchParamsWithSchema validates query params", async () => {
  const schema = z
    .object({
      page: z.coerce.number().int().min(1),
      q: z.string().optional(),
    })
    .strict();

  const valid = parseSearchParamsWithSchema(
    new URLSearchParams("page=2&q=heriz"),
    schema
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.page, 2);
    assert.equal(valid.value.q, "heriz");
  }

  const invalid = parseSearchParamsWithSchema(
    new URLSearchParams("page=0"),
    schema,
    "Invalid query params."
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.response.status, 400);
  }
});
