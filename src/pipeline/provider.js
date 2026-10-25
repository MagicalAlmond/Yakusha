/**
 * Translation providers.
 *
 * A provider is any async function that takes a batch of items and returns one
 * translated string per item. Everything else - batching, validation, retries,
 * glossary, progress - lives in the pipeline, so adding a backend is a small,
 * self contained file.
 *
 * Two providers ship today:
 *
 *   openai   any OpenAI compatible /chat/completions endpoint (OpenAI,
 *            DeepSeek, OpenRouter, Ollama, LM Studio, vLLM ...)
 *   mock     deterministic pseudo translation used by the test suite and by
 *            --dry-run, so the whole pipeline can be exercised offline
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
 * @property {number} [temperature]
 * @property {number} [timeoutMs]
 * @property {number} [maxTokens]
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

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
 * Any OpenAI compatible chat completion endpoint.
 *
 * @param {ProviderOptions} [options]
 * @returns {Provider}
 */
export function openaiProvider(options = {}) {
  const baseUrl = (options.baseUrl || process.env.YAKUSHA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = options.apiKey || process.env.YAKUSHA_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = options.model || process.env.YAKUSHA_MODEL || DEFAULT_MODEL;
  const temperature = options.temperature === undefined ? 0.3 : options.temperature;
  const timeoutMs = options.timeoutMs || 120000;
  const maxTokens = options.maxTokens || 4096;

  return {
    name: "openai:" + model,
    async complete(context) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (context.signal) context.signal.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const response = await fetch(baseUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(apiKey ? { authorization: "Bearer " + apiKey } : {}),
          },
          body: JSON.stringify({
            model,
            temperature,
            max_tokens: maxTokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: context.systemPrompt },
              { role: "user", content: context.userPrompt },
            ],
          }),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          // The body can echo the whole request, Authorization header included,
          // so it must never reach an error message. The status is enough to
          // act on; YAKUSHA_DEBUG=1 shows the body on stderr elsewhere.
          const error = new Error("provider returned HTTP " + response.status);
          error.code = "E_PROVIDER";
          throw error;
        }
        const body = JSON.parse(text);
        const choice = body.choices && body.choices[0];
        if (!choice || !choice.message || typeof choice.message.content !== "string") {
          const error = new Error("provider returned no message content");
          error.code = "E_PROVIDER";
          throw error;
        }
        return choice.message.content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
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
  const error = new Error("unknown provider: " + name + " (expected openai or mock)");
  error.code = "E_PROVIDER";
  throw error;
}
