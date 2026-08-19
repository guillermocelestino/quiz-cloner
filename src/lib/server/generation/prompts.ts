/**
 * Prompt construction for the reasoning model (server-only).
 *
 * Embeds docs/GOLDEN_EXEMPLAR.md as the style target and enforces strict
 * grounding rules against structured exercise items and declarative facts.
 */
import { PROMPT_VERSION, type GradeProfile, type ReviewerConfig } from "@/lib/types";
import type { SourceFact } from "@/lib/server/validation/grounding";

const GOLDEN_EXEMPLAR_SNIPPET = `GOLDEN EXEMPLAR STYLE TARGET (Grade 1 L-Blends):
Declarative Facts:
- [F1] L-blends are consonant blends that end with the letter 'l'.
- [F2] A clock tells us the time.
- [F3] A flag waves in the wind.

Exercise Items:
- [F4] Item #1: "Fill in missing blend: (bl-, cl-, fl-, gl-, pl-, sl-) ____ock" [wordBank: ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"], pictureCue: "clock"]

Ideal Target Questions Output:
{
  "questions": [
    {
      "type": "blend_mc",
      "question": "Which blend completes the word for a picture of a clock? ____ock",
      "choices": ["bl-", "cl-", "fl-"],
      "answer": "cl-",
      "sourceFactId": "F4",
      "difficulty": "easy"
    },
    {
      "type": "fill_blank",
      "question": "A ____ waves in the wind.",
      "answer": "flag",
      "sourceFactId": "F3",
      "difficulty": "easy"
    },
    {
      "type": "tf_exact",
      "question": "True or False: A clock tells us the time.",
      "answer": "True",
      "sourceFactId": "F2",
      "difficulty": "easy"
    },
    {
      "type": "tf_swap",
      "question": "True or False: A plum waves in the wind.",
      "answer": "False",
      "sourceFactId": "F3",
      "difficulty": "normal"
    },
    {
      "type": "reverse_id",
      "question": "What tells us the time?",
      "answer": "clock",
      "sourceFactId": "F2",
      "difficulty": "normal"
    }
  ]
}`;

export function buildPlanningSystemPrompt(profile: GradeProfile): string {
  return `You are an expert AI curriculum planner for Grade ${profile.grade}.
Your task is to produce ONLY a high-level question generation plan.
You do NOT write full question text or answers in this stage.

You map source fact IDs to question types to achieve maximum coverage and type balance.
Question types available: "blend_mc", "fill_blank", "tf_exact", "tf_swap", "reverse_id", "multiple_choice", "true_false", "identification", "word_family_mc", "first_letter_fill".

Return ONLY valid JSON matching this schema:
{
  "plan": [
    { "sourceFactId": "F1", "questionType": "blend_mc" },
    { "sourceFactId": "F2", "questionType": "first_letter_fill" }
  ]
}`;
}

export function buildPlanningUserPrompt(args: {
  subject: string;
  profile: GradeProfile;
  config: ReviewerConfig;
  facts: SourceFact[];
}): string {
  const factsList = args.facts.map((f) => `[${f.id}] ${f.text}`).join("\n");
  return `SUBJECT: ${args.subject}
GRADE: ${args.profile.grade}
REQUESTED QUESTION COUNT: ${args.config.questionCount}
ALLOWED QUESTION TYPES: ${args.config.questionTypes.join(", ")}

VERIFIED SOURCE FACTS:
${factsList}

Create a balanced plan mapping sourceFactId to questionType for up to ${args.config.questionCount} questions.
Ensure balanced distribution of question types. Do NOT repeat the same type more than 3 times consecutively.
Return ONLY valid JSON: { "plan": [...] }`;
}

export function buildSystemPrompt(profile: GradeProfile): string {
  return `You are an expert author of Grade ${profile.grade} study reviewers for young children (around 6-7 years old).

${GOLDEN_EXEMPLAR_SNIPPET}

ABSOLUTE GROUNDING & GENERATION RULES:
1. You MUST use the provided "wordBank" array (or "pageWordFamily") for multiple-choice distractors (choices ⊆ wordBank/pageWordFamily, exactly ${profile.maxChoices} choices for Grade 1).
2. You MUST NOT invent facts outside of the provided ExerciseItems and DeclarativeFacts.
3. Fill-in-the-blank questions MUST use the exact "blankToken" provided (or "_ _", or "b _ _ _ _" for first_letter_fill).
4. False statements for True/False ("tf_swap") MUST be built ONLY by swapping in a word that exists elsewhere in the verified snapshot.
5. Match the exact tone, simplicity, and structure of the Golden Exemplar.
6. Every question must cite the exact fact id (e.g. F3) in "sourceFactId".
7. Keep sentences short and direct (max ${profile.maxSentenceWords} words).

Return ONLY valid JSON, no commentary. JSON Schema:
{
  "questions": [
    {
      "type": "blend_mc" | "fill_blank" | "tf_exact" | "tf_swap" | "reverse_id" | "multiple_choice" | "true_false" | "identification" | "word_family_mc" | "first_letter_fill",
      "question": "string",
      "answer": "string",
      "choices": ["string array for multiple_choice / blend_mc / word_family_mc"],
      "sourceFactId": "F1",
      "sourcePage": "string or null",
      "difficulty": "easy" | "normal" | "challenge"
    }
  ]
}`;
}

function typeRules(types: ReviewerConfig["questionTypes"]): string {
  const lines: string[] = [];
  if (types.includes("blend_mc") || types.includes("multiple_choice"))
    lines.push("- Multiple Choice (blend_mc / multiple_choice): exactly 3 choices for Grade 1, taken strictly from wordBank.");
  if (types.includes("word_family_mc"))
    lines.push("- Multiple Choice (Word Family - word_family_mc): distractors sampled from words on the same page (pageWordFamily).");
  if (types.includes("first_letter_fill"))
    lines.push("- First Letter Fill-in-the-Blank (first_letter_fill): rendered as first letter + underscores (e.g. 'b _ _ _ _').");
  if (types.includes("fill_blank"))
    lines.push("- Fill in the Blank (fill_blank): blank out one key term using exact blankToken.");
  if (types.includes("tf_exact") || types.includes("true_false"))
    lines.push("- True / False (tf_exact / true_false): statement derived directly from source fact; answer is 'True'.");
  if (types.includes("tf_swap"))
    lines.push("- True / False Swap (tf_swap): create a FALSE statement by swapping in a term from another verified fact; answer is 'False'.");
  if (types.includes("reverse_id") || types.includes("identification"))
    lines.push("- Identification (reverse_id / identification): ask about a direct concept from the source.");
  return lines.join("\n");
}

export function buildUserPrompt(args: {
  subject: string;
  profile: GradeProfile;
  config: ReviewerConfig;
  facts: SourceFact[];
  pageInstructions?: string[];
  structuredPayload?: {
    declarativeFacts: Array<{ id: string; content: string; pageLabel?: string | null }>;
    exerciseItems: Array<{
      id: string;
      itemNumber?: number | null;
      sentence: string;
      blankToken?: string | null;
      wordBank?: string[] | null;
      pictureCue?: string | null;
      proposedAnswer?: string | null;
      pageLabel?: string | null;
    }>;
  };
}): string {
  const { subject, profile, config, facts, pageInstructions, structuredPayload } = args;

  let instructionsBlock = "";
  if (pageInstructions && pageInstructions.length > 0) {
    instructionsBlock = `PAGE INSTRUCTIONS (Background context only; NEVER use as sourceFactId for questions):\n${pageInstructions.map((i) => `• ${i}`).join("\n")}\n\n`;
  }

  let factsBlock = "";
  if (structuredPayload) {
    const decs = structuredPayload.declarativeFacts
      .map((d) => `[${d.id}] DeclarativeFact: "${d.content}" ${d.pageLabel ? `(Page ${d.pageLabel})` : ""}`)
      .join("\n");
    const exes = structuredPayload.exerciseItems
      .map(
        (e) =>
          `[${e.id}] ExerciseItem #${e.itemNumber ?? ""}: "${e.sentence}" [blankToken: "${e.blankToken || "_ _"}", wordBank: ${
            e.wordBank ? JSON.stringify(e.wordBank) : "null"
          }, pictureCue: "${e.pictureCue || ""}", proposedAnswer: "${e.proposedAnswer || ""}"] ${
            e.pageLabel ? `(Page ${e.pageLabel})` : ""
          }`
      )
      .join("\n");
    factsBlock = `${instructionsBlock}DECLARATIVE FACTS:\n${decs || "(none)"}\n\nEXERCISE ITEMS:\n${exes || "(none)"}`;
  } else {
    factsBlock = `${instructionsBlock}` + facts
      .map((f) => `[${f.id}] ${f.pageLabel ? `(${f.pageLabel}) ` : ""}${f.text}`)
      .join("\n");
  }

  const teacher = config.teacherInstructions?.trim()
    ? `\nTEACHER INSTRUCTIONS (prioritize existing verified content; never introduce new facts):\n${config.teacherInstructions.trim()}\n`
    : "";

  return `SUBJECT: ${subject}
GRADE: ${profile.grade}
DIFFICULTY: ${config.difficulty}

VERIFIED SOURCE SNAPSHOT (the ONLY information you may use):
${factsBlock}
${teacher}
Create up to ${config.questionCount} questions following these question type rules:
${typeRules(config.questionTypes)}

Return ONLY the JSON object conforming to the schema.`;
}

export function buildRegenerationPrompt(args: {
  facts: SourceFact[];
  failures: { question: string; reason: string }[];
}): string {
  const factsBlock = args.facts.map((f) => `[${f.id}] ${f.text}`).join("\n");
  const failBlock = args.failures
    .map((f, i) => `${i + 1}. "${f.question}" -> REJECTED because: ${f.reason}`)
    .join("\n");

  return `Some questions were rejected during validation. Replace EACH of them with a corrected, fully grounded question adhering to the Golden Exemplar rules.

VERIFIED SOURCE:
${factsBlock}

REJECTED QUESTIONS:
${failBlock}

Fix the specific problems. Cite a valid fact id. Return ONLY the JSON object with the replacement questions.`;
}

export function buildGrade1ReviewerSystemPrompt(): string {
  return `You are an expert Early Childhood Curriculum Designer, Phonics Specialist, and Grade 1 Exam Writer.
Your task is to transform textbook page content into a complete, solvable Grade 1 Reviewer and Parent Answer Key.

---

### CORE PRINCIPLE: INSTRUCTION AS THE FIRST-CLASS CONTEXT
Early childhood exercises rely on page instructions to define meaning, grammar rules, and answer banks. 
Treat the instruction on each page as the primary source of truth:
1. Extract the verbatim instruction (e.g., "Complete each word with a consonant blend (bl-, cl-, fl-, gl-, pl-, sl-).").
2. Parse any explicit blend list, word box, or choices embedded in the instruction into "availableBank".
3. Use the instruction + bank to resolve incomplete items (e.g., matching "__ __ ag" + bank "fl-" + visual cue "flag on pole" -> targetWord: "flag", targetKey: "fl-").

---

### QUESTION FORMATTING RULES

1. Self-Contained Reviewer Items:
   - For Multiple Choice ("phonics_mc"):
     * Prompt must contain a clear blank: "That _____ ag is on the pole."
     * Options must contain EXACTLY 3 choices from the verified "availableBank": ["A. fl-", "B. bl-", "C. pl-"].
   - For Fill in the Blank ("fill_blank"):
     * Include a word box directly in the section instructions: "Use the word box: [ plates | plug | globe ]"
     * Prompt: "These _____ are clean."
   - For True / False ("tf_simple"):
     * Simple declarative statements under 8 words (e.g., "A flag flies on a pole.").

2. Grade 1 Constraints:
   - Max 10 words per prompt.
   - Use simple sight words (is, are, the, can, see, on, has, put).
   - Never output unresolved prompts without choices or word banks (e.g., never output "That __ ag is on the pole" without options).

3. Parent Answer Key:
   - Include concise, 5-to-8 word explanations for every item (e.g., "fl + ag = flag (flies on a pole)").

---

### STRICT JSON OUTPUT FORMAT
Respond ONLY with a raw, valid JSON object matching this exact schema:

{
  "unitTopic": "string (e.g., Words with L-Blends)",
  "sourceInstruction": "string (verbatim page instruction)",
  "availableBank": ["string"],
  "sections": [
    {
      "sectionTitle": "string (e.g., Part I: Circle the Missing Blend)",
      "formatType": "phonics_mc | fill_blank | first_letter_fill | tf_simple",
      "sectionInstructions": "string (e.g., Choose the correct blend to complete each word:)",
      "questions": [
        {
          "itemNumber": 1,
          "sourceItemRef": "string (e.g., Page 94, Item 2)",
          "promptText": "string (e.g., That _____ ag is on the pole.)",
          "blankToken": "_____",
          "options": ["A. fl-", "B. bl-", "C. pl-"],
          "correctAnswer": "A. fl-",
          "targetWord": "flag",
          "parentExplanation": "fl + ag = flag (flies on a pole)"
        }
      ]
    }
  ]
}`;
}

export function buildGrade1ReviewerUserPrompt(args: {
  subject?: string;
  sourceText: string;
  availableBank?: string[];
}): string {
  const subjectStr = args.subject ? `Subject: ${args.subject}\n` : "";
  const bankStr = args.availableBank && args.availableBank.length > 0
    ? `Available Bank: ${JSON.stringify(args.availableBank)}\n`
    : "";

  return `${subjectStr}${bankStr}VERIFIED SOURCE TEXTBOOK PAGE CONTENT:
${args.sourceText}

Generate the complete, print-ready Grade 1 Reviewer and Answer Key JSON pass.`;
}

export { PROMPT_VERSION };
