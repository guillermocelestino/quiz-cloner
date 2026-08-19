/**
 * Shared NVIDIA build.nvidia.com client.
 *
 * NVIDIA exposes an OpenAI-compatible Chat Completions API at:
 *   https://integrate.api.nvidia.com/v1/chat/completions
 *
 * This module is the ONLY place that touches the raw NVIDIA HTTP contract, so
 * the endpoint / request format / response parser can change without rewriting
 * the rest of the application.
 *
 * SECURITY: NVIDIA_API_KEY is read from process.env and NEVER exposed to the
 * browser. This file is server-only.
 */

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export type NvidiaErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "bad_response"
  | "server";

export class NvidiaError extends Error {
  kind: NvidiaErrorKind;
  status?: number;
  constructor(message: string, kind: NvidiaErrorKind, status?: number) {
    super(message);
    this.name = "NvidiaError";
    this.kind = kind;
    this.status = status;
  }
}

export function getApiKey(): string | undefined {
  return process.env.NVIDIA_API_KEY?.trim() || undefined;
}

export function isDemoMode(): boolean {
  // Explicit demo flag, or no key configured.
  return process.env.NVIDIA_DEMO_MODE === "1" || !getApiKey();
}

export function getOcrModel(): string {
  return process.env.NVIDIA_OCR_MODEL || "meta/llama-3.2-11b-vision-instruct";
}

export function getReasoningModel(): string {
  return (
    process.env.NVIDIA_REASONING_MODEL ||
    "nvidia/nemotron-3-super-120b-a12b"
  );
}

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  enableThinking?: boolean;
  signal?: AbortSignal;
};

/**
 * Calls the NVIDIA chat completions endpoint (non-streaming) and returns the
 * raw JSON body. Throws NvidiaError with a friendly kind on failure.
 */
export async function chatCompletion(
  options: ChatOptions
): Promise<{
  content: string;
  raw: unknown;
  model: string;
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new NvidiaError(
      "NVIDIA API key is not configured.",
      "auth"
    );
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.2,
    top_p: options.topP ?? 1,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  };
  // Nemotron 3 Super supports a chat template that emits reasoning_content.
  // We disable it so we get clean, parseable JSON content.
  if (options.enableThinking === false) {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  let res: Response;
  const timeoutSignal = AbortSignal.timeout(45000);
  const fetchSignal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

  try {
    res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError" || timeoutSignal.aborted) {
      throw new NvidiaError("The request took too long and was cancelled.", "timeout");
    }
    throw new NvidiaError(
      "We could not reach the NVIDIA service. Check your connection and try again.",
      "network"
    );
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new NvidiaError(
        "NVIDIA rejected the API key. Check that NVIDIA_API_KEY is valid.",
        "auth",
        res.status
      );
    }
    if (res.status === 429) {
      throw new NvidiaError(
        "NVIDIA is busy right now (rate limit). Please wait a moment and try again.",
        "rate_limit",
        res.status
      );
    }
    if (res.status >= 500) {
      throw new NvidiaError(
        "NVIDIA's service had a temporary problem. Please try again.",
        "server",
        res.status
      );
    }
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: string; error?: string };
      detail = j.detail || j.error || "";
    } catch {
      /* ignore */
    }
    throw new NvidiaError(
      `NVIDIA returned an error (${res.status}). ${detail}`.trim(),
      "bad_response",
      res.status
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new NvidiaError("NVIDIA returned a response we could not read.", "bad_response");
  }

  const choices = (json as { choices?: Array<{ message?: { content?: string } }> })
    ?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new NvidiaError(
      "NVIDIA returned an unexpected response with no content.",
      "bad_response"
    );
  }

  return { content, raw: json, model: options.model };
}
