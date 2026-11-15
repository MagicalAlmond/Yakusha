/**
 * Translation providers.
 *
 * A provider is any async function that takes a batch of items and returns one
 * translated string per item. Everything else - batching, validation, retries,
 * glossary, progress - lives in the pipeline, so adding a backend is a small,
 * self contained file.
 *
 * Two wire formats ship today:
 *
 *   chat-completions   any OpenAI compatible /chat/completions endpoint
 *   responses          the OpenAI Responses API (/responses)
 *
 * The names openai and compatible both build the same provider; the configured
 * apiFormat chooses the endpoint shape. mock is deterministic and used by the
 * test suite and --dry-run.
 *
 * @module pipeline/provider
 */

/**
 * @typedef {object} ProviderContext
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} Provider
 * @property {string} name
 * @property {(context: ProviderContext) => Promise<string>} complete
 */

/**
 * @typedef {object} ProviderOptions
 * @property {string} [baseUrl]
 * @property {string} [apiKey]
 * @property {string} [model]
 * @property {string} [apiFormat] "chat-completions" or "responses"
 * @property {number} [temperature]
 * @property {number} [timeoutMs]
 * @property {number} [maxTokens]
 * @property {Function} [fetchImpl] injectable fetch for tests and model listing
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const API_FORMATS = new Set(["chat-completions", "responses"]);

/**
 * @param {string} message
 * @param {string} code
 */
function providerError(message, code = "E_PROVIDER") {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * An offline provider that "translates" by tagging the source.
 *
 * The default prefix is not empty on purpose: the pipeline rejects a Japanese
 * source that comes back unchanged, so a bare echo would never validate.
 *
 * @returns {Provider}
 */
export function mockProvider(options = {}) {
  const prefix = options.prefix === undefined ? "译:" : options.prefix;
  return {
    name: "mock",
    async complete(context) {
      const payload = JSON.parse(context.userPrompt);
      return JSON.stringify({
        translations: payload.items.map((item) => ({ i: item.i, t: prefix + item.text })),
      });
    },
  };
}

/**
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {string} apiFormat
 * @param {string} model
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {number} temperature
 * @param {number} maxTokens
 */
function requestBody(apiFormat, model, systemPrompt, userPrompt, temperature, maxTokens) {
  if (apiFormat === "responses") {
    return {
      model,
      instructions: systemPrompt,
      input: userPrompt,
      temperature,
      max_output_tokens: maxTokens,
      text: { format: { type: "json_object" } },
    };
  }
  return {
    model,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  };
}

/**
 * Pull the assistant text out of either a chat completion or a Responses API
 * body. The raw HTTP shape and the SDK convenience field are both accepted.
 *
 * @param {unknown} body
 * @param {string} apiFormat
 * @returns {string|null}
 */
export function extractProviderText(body, apiFormat = "chat-completions") {
  if (!body || typeof body !== "object") return null;
  if (apiFormat === "responses") {
    if (typeof body.output_text === "string" && body.output_text.length > 0) return body.output_text;
    if (Array.isArray(body.output)) {
      const parts = [];
      for (const item of body.output) {
        if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
          if (part && typeof part === "object" && typeof part.text === "string") parts.push(part.text);
        }
      }
      if (parts.length > 0) return parts.join("");
    }
    return null;
  }
  const choice = body.choices && body.choices[0];
  if (!choice || !choice.message || typeof choice.message.content !== "string") return null;
  return choice.message.content;
}

/**
 * Any OpenAI compatible chat completion or Responses endpoint.
 *
 * @param {ProviderOptions} [options]
 * @returns {Provider}
 */
export function openaiProvider(options = {}) {
  // 0.10 has no built-in model and no built-in key. A silent gpt-4o-mini
  // fallback made the tool look configured when it was not, and it could only
  // fail later at the endpoint (or, with a third-party base URL, at the wrong
  // endpoint). Both values must come from a flag, an environment variable or
  // the user config file, so a missing setup fails locally before any request.
  const baseUrl = (options.baseUrl || process.env.YAKUSHA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = options.apiKey || process.env.YAKUSHA_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = options.model || process.env.YAKUSHA_MODEL;
  const apiFormat = String(options.apiFormat || "chat-completions").toLowerCase();
  if (!model) {
    throw providerError("no model configured: pass --model or set YAKUSHA_MODEL", "E_CONFIG");
  }
  if (!apiKey) {
    throw providerError("no API key configured: pass --api-key or set YAKUSHA_API_KEY or OPENAI_API_KEY", "E_CONFIG");
  }
  if (!API_FORMATS.has(apiFormat)) {
    throw providerError("apiFormat must be chat-completions or responses", "E_CONFIG");
  }
  const temperature = options.temperature === undefined ? 0.3 : options.temperature;
  const timeoutMs = options.timeoutMs || 120000;
  const maxTokens = options.maxTokens || 4096;
  const fetchImpl = options.fetchImpl || fetch;

  return {
    name: "openai:" + model + " (" + apiFormat + ")",
    async complete(context) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (context.signal) context.signal.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const endpoint = apiFormat === "responses" ? "/responses" : "/chat/completions";
        const response = await fetchImpl(baseUrl + endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: "Bearer " + apiKey } : {}),
          },
          body: JSON.stringify(requestBody(apiFormat, model, context.systemPrompt, context.userPrompt, temperature, maxTokens)),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          // The body can echo the whole request, Authorization header included,
          // so it must never reach an error message or stderr: the status alone
          // is what every caller acts on, and YAKUSHA_DEBUG only ever widens
          // stack traces, never response bodies.
          throw providerError("provider returned HTTP " + response.status);
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          throw providerError("provider returned invalid JSON");
        }
        const content = extractProviderText(body, apiFormat);
        if (content === null) throw providerError("provider returned no message content");
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * List models advertised by an OpenAI compatible /models endpoint.
 *
 * The result is sorted and de-duplicated so a picker can render it directly.
 * mock has one synthetic model and never touches the network.
 *
 * @param {ProviderOptions & {provider?: string}} [options]
 * @returns {Promise<string[]>}
 */
export async function listModels(options = {}) {
  const provider = String(options.provider || "openai").toLowerCase();
  if (provider === "mock") return ["mock"];
  if (provider !== "openai" && provider !== "compatible") {
    throw providerError("unknown provider: " + options.provider + " (expected openai, compatible or mock)");
  }
  const baseUrl = (options.baseUrl || process.env.YAKUSHA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (provider === "compatible" && !options.baseUrl && !process.env.YAKUSHA_BASE_URL) {
    throw providerError("no base URL configured for provider compatible: pass --base-url or configure baseUrl", "E_CONFIG");
  }
  const apiKey = options.apiKey || process.env.YAKUSHA_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    throw providerError("no API key configured: pass --api-key or set YAKUSHA_API_KEY or OPENAI_API_KEY", "E_CONFIG");
  }
  const timeoutMs = options.timeoutMs || 30000;
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(baseUrl + "/models", {
      method: "GET",
      headers: { authorization: "Bearer " + apiKey },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw providerError("provider returned HTTP " + response.status);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw providerError("provider returned invalid JSON");
    }
    if (!body || !Array.isArray(body.data)) throw providerError("provider returned no model list");
    const models = [...new Set(body.data.map((item) => (item && typeof item.id === "string" ? item.id.trim() : "")).filter(Boolean))];
    models.sort((a, b) => a.localeCompare(b));
    return models;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} name
 * @param {ProviderOptions} [options]
 * @returns {Provider}
 */
export function createProvider(name, options = {}) {
  const key = String(name || "openai").toLowerCase();
  if (key === "mock") return mockProvider(options);
  if (key === "openai" || key === "compatible") return openaiProvider(options);
  throw providerError("unknown provider: " + name + " (expected openai, compatible or mock)");
}
