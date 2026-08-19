/**
 * NVIDIA Nemotron 3 Super 120B A12B integration (server-only).
 *
 * This model receives TEXT ONLY (the verified source snapshot) and returns
 * strict JSON. It never reads images.
 */
import { chatCompletion, getReasoningModel, isDemoMode } from "./nvidia-client";

export type ReasoningInput = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
};

export type ReasoningOutput = {
  content: string;
  raw: unknown;
  model: string;
  demo: boolean;
};

/** Extract the first JSON object/array from a model response. */
export function extractJson(content: string): string {
  let text = content.trim();

  // Strip Markdown code fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
  }

  // Find the outermost JSON structure.
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  let start = -1;
  let openCh = "{";
  let closeCh = "}";

  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
  } else if (firstArr !== -1) {
    start = firstArr;
    openCh = "[";
    closeCh = "]";
  }

  if (start === -1) return text;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

const SAMPLE_QUESTIONS = `{
  "questions": [
    {
      "type": "fill_blank",
      "question": "Roots absorb ______ from the soil.",
      "answer": "water",
      "sourceFactId": "F6",
      "sourcePage": "Parts of a Plant",
      "difficulty": "easy"
    },
    {
      "type": "true_false",
      "question": "Roots hold the plant in the soil.",
      "answer": "True",
      "sourceFactId": "F5",
      "sourcePage": "Parts of a Plant",
      "difficulty": "easy"
    },
    {
      "type": "identification",
      "question": "What part of the plant absorbs water?",
      "answer": "Roots",
      "sourceFactId": "F6",
      "sourcePage": "Parts of a Plant",
      "difficulty": "easy"
    },
    {
      "type": "multiple_choice",
      "question": "Which part holds the plant up?",
      "choices": ["Roots", "Stem", "Leaves"],
      "answer": "Stem",
      "sourceFactId": "F8",
      "sourcePage": "Parts of a Plant",
      "difficulty": "easy"
    },
    {
      "type": "fill_blank",
      "question": "Leaves make ______ for the plant.",
      "answer": "food",
      "sourceFactId": "F11",
      "sourcePage": "Parts of a Plant",
      "difficulty": "easy"
    }
  ]
}`;

/**
 * Call Nemotron 3 Super 120B with a strict-JSON task.
 * Thinking is disabled so the content is directly parseable JSON.
 */
export async function runNemotronReasoning(
  input: ReasoningInput
): Promise<ReasoningOutput> {
  const model = getReasoningModel();

  if (isDemoMode()) {
    return {
      content: SAMPLE_QUESTIONS,
      raw: { demo: true, note: "Deterministic sample questions (no API key configured)." },
      model: `${model} (demo)`,
      demo: true,
    };
  }

  const { content, raw } = await chatCompletion({
    model,
    temperature: input.temperature ?? 0.5,
    topP: 0.95,
    maxTokens: input.maxTokens ?? 8192,
    enableThinking: false,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  });

  return { content, raw, model, demo: false };
}
