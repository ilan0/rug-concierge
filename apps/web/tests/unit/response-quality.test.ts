import test from "node:test";
import assert from "node:assert/strict";
import { postOpenAiResponses } from "../../lib/ai/response-quality";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_RETRY_ATTEMPTS = process.env.OPENAI_RETRY_ATTEMPTS;
const ORIGINAL_RETRY_BASE_MS = process.env.OPENAI_RETRY_BASE_MS;
const ORIGINAL_TIMEOUT_MS = process.env.OPENAI_TIMEOUT_MS;

function restoreEnv() {
  if (ORIGINAL_RETRY_ATTEMPTS === undefined) {
    delete process.env.OPENAI_RETRY_ATTEMPTS;
  } else {
    process.env.OPENAI_RETRY_ATTEMPTS = ORIGINAL_RETRY_ATTEMPTS;
  }

  if (ORIGINAL_RETRY_BASE_MS === undefined) {
    delete process.env.OPENAI_RETRY_BASE_MS;
  } else {
    process.env.OPENAI_RETRY_BASE_MS = ORIGINAL_RETRY_BASE_MS;
  }

  if (ORIGINAL_TIMEOUT_MS === undefined) {
    delete process.env.OPENAI_TIMEOUT_MS;
  } else {
    process.env.OPENAI_TIMEOUT_MS = ORIGINAL_TIMEOUT_MS;
  }
}

test("postOpenAiResponses retries transient status codes then succeeds", async (t) => {
  process.env.OPENAI_RETRY_ATTEMPTS = "3";
  process.env.OPENAI_RETRY_BASE_MS = "1";
  process.env.OPENAI_TIMEOUT_MS = "100";

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return new Response(JSON.stringify({ error: "retry me" }), { status: 429 });
    }
    return new Response(JSON.stringify({ output_text: "{}" }), { status: 200 });
  };

  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    restoreEnv();
  });

  const result = await postOpenAiResponses({
    url: "https://example.test/openai",
    apiKey: "test",
    requestPayload: { model: "test" },
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  assert.equal(result.response_status, 200);
});

test("postOpenAiResponses does not retry non-retryable status", async (t) => {
  process.env.OPENAI_RETRY_ATTEMPTS = "3";
  process.env.OPENAI_RETRY_BASE_MS = "1";
  process.env.OPENAI_TIMEOUT_MS = "100";

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  };

  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    restoreEnv();
  });

  const result = await postOpenAiResponses({
    url: "https://example.test/openai",
    apiKey: "test",
    requestPayload: { model: "test" },
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(result.response_status, 400);
});

test("postOpenAiResponses retries network failure then succeeds", async (t) => {
  process.env.OPENAI_RETRY_ATTEMPTS = "2";
  process.env.OPENAI_RETRY_BASE_MS = "1";
  process.env.OPENAI_TIMEOUT_MS = "100";

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("network down");
    }
    return new Response(JSON.stringify({ output_text: "{}" }), { status: 200 });
  };

  t.after(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    restoreEnv();
  });

  const result = await postOpenAiResponses({
    url: "https://example.test/openai",
    apiKey: "test",
    requestPayload: { model: "test" },
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(result.response_status, 200);
});
