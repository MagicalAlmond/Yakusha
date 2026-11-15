/**
 * Wire-format tests for the translation provider (0.13+).
 *
 * openai and compatible both speak two shapes: the classic Chat Completions
 * endpoint and the newer Responses API. These tests pin the request body and
 * the reply extraction for both so a future refactor cannot silently change
 * the wire contract of a configured endpoint.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createProvider, extractProviderText, listModels } from "../src/pipeline/provider.js";

/** @returns {{ ok: boolean, status: number, text: () => Promise<string> }} */
function reply(body, { ok = true, status = 200, raw } = {}) {
  return { ok, status, text: async () => (raw === undefined ? JSON.stringify(body) : raw) };
}

test("provider: chat completions posts messages and reads choices[0].message.content", async () => {
  const calls = [];
  const provider = createProvider("openai", {
    apiKey: "test-key", model: "demo", apiFormat: "chat-completions",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return reply({ choices: [{ message: { content: "{\"translations\":[]}" } }] });
    },
  });
  const text = await provider.complete({ systemPrompt: "system", userPrompt: "{\"items\":[]}" });
  assert.equal(text, "{\"translations\":[]}");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "demo");
  assert.equal(body.max_tokens, 4096);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.deepEqual(body.messages, [
    { role: "system", content: "system" },
    { role: "user", content: "{\"items\":[]}" },
  ]);
  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");
});

test("provider: responses posts instructions/input and reads output_text", async () => {
  const calls = [];
  const provider = createProvider("compatible", {
    apiKey: "test-key", model: "demo", baseUrl: "http://127.0.0.1:8080/v1", apiFormat: "responses",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return reply({ output_text: "{\"translations\":[]}" });
    },
  });
  const text = await provider.complete({ systemPrompt: "system", userPrompt: "input" });
  assert.equal(text, "{\"translations\":[]}");
  assert.equal(calls[0].url, "http://127.0.0.1:8080/v1/responses");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.instructions, "system");
  assert.equal(body.input, "input");
  assert.equal(body.max_output_tokens, 4096);
  assert.deepEqual(body.text, { format: { type: "json_object" } });
  assert.equal(Object.hasOwn(body, "messages"), false);
});

test("provider: responses can read the raw output array when output_text is absent", () => {
  assert.equal(extractProviderText({ output: [{ content: [{ text: "a" }, { text: "b" }] }] }, "responses"), "ab");
  assert.equal(extractProviderText({ output: [] }, "responses"), null);
});

test("provider: an unknown api format is E_CONFIG before any request", () => {
  assert.throws(
    () => createProvider("openai", { apiKey: "k", model: "m", apiFormat: "xml" }),
    (error) => error.code === "E_CONFIG" && /apiFormat/.test(error.message),
  );
});

test("provider: listModels sorts and de-duplicates ids", async () => {
  let request;
  const models = await listModels({
    provider: "openai", apiKey: "test-key",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return reply({ data: [{ id: "b" }, { id: "a" }, { id: "b" }, {}] });
    },
  });
  assert.deepEqual(models, ["a", "b"]);
  assert.equal(request.url, "https://api.openai.com/v1/models");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.headers.authorization, "Bearer test-key");
});

test("provider: listModels mock is offline", async () => {
  assert.deepEqual(await listModels({ provider: "mock" }), ["mock"]);
});

test("provider: listModels needs a key for a real endpoint", async () => {
  await assert.rejects(
    () => listModels({ provider: "compatible", baseUrl: "http://127.0.0.1:8080/v1" }),
    (error) => error.code === "E_CONFIG" && /API key/.test(error.message),
  );
});

test("provider: createProvider names the format so the progress line is honest", () => {
  const provider = createProvider("openai", { apiKey: "k", model: "m", apiFormat: "responses" });
  assert.equal(provider.name, "openai:m (responses)");
});
