# AI Pipelines & Model Integration

## Simplified AI Pipeline Overview

```
                      DUAL-ENGINE RESILIENT AI PIPELINE
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   Textbook Images   │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │  Image Optimization │
                          │ (Sharp 1400px JPEG) │
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │  AI Engine Router   │
                          │ (GEMINI_API_KEY ?)  │
                          └────┬───────────┬────┘
                               │           │
                     PRIMARY   │           │ FALLBACK / DEFAULT
                     (Gemini)  │           │ (Nemotron)
                               ▼           ▼
                   ┌──────────────┐     ┌─────────────────────┐
                   │ Gemini Vision│     │ Nemotron Vision OCR │
                   │ OCR Engine   │     │(Handwriting-Aware)  │
                   │(2.5/2.0/1.5) │     │ (Llama-3.2-11B)     │
                   └───────┬──────┘     └──────────┬──────────┘
                           │                       │
                           └───────────┬───────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │  OCR Normalization  │
                            │ & Prose/Hint Guard  │
                            └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │ Parent Verification │
                            │(State-Aware UI &    │
                            │ Click-to-Blank)     │
                            └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │    Verified Text    │
                            │ & Fact Isolation    │
                            └──────────┬──────────┘
                                       │
                                       ▼
                          ┌─────────────────────┐
                          │  AI Engine Router   │
                          │ (GEMINI_API_KEY ?)  │
                          └────┬───────────┬────┘
                               │           │
                     PRIMARY   │           │ FALLBACK / DEFAULT
                     (Gemini)  │           │ (Nemotron)
                               ▼           ▼
                   ┌──────────────┐     ┌─────────────────────┐
                   │Gemini Grade1 │     │ 2-Stage Plan/Write  │
                   │ Reviewer Gen │     │ (Nemotron 120B)     │
                   └───────┬──────┘     └──────────┬──────────┘
                           │                       │
                           └───────────┬───────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │ Grounding & Multi-  │
                            │ Format Validation   │
                            └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │  Reviewer & Key PDF │
                            │ + Evals & Feedback  │
                            └─────────────────────┘
```

---

## Detailed AI Pipeline Stages

### Stage 1: Image Preprocessing & Payload Optimization
- **Module**: `src/lib/server/ai/gemini-ocr.ts` & `src/lib/server/storage.ts`.
- **Engine**: Node.js `sharp` image processing pipeline.
- **Process**:
  - Automatically resizes raw uploaded textbook images (JPEG, PNG, WebP) to fit within a 1400x1400 bounding box (`fit: "inside"`, `withoutEnlargement: true`).
  - Flattens transparency layers against a clean `#ffffff` background.
  - Compresses to 80% JPEG quality, dropping payload sizes down to ~150–250 KB for instant Vision OCR API delivery.

### Stage 2: Handwriting-Aware Dual-Engine Vision OCR
- **Module**: `src/lib/server/ai/gemini-ocr.ts`, `src/lib/server/ai/nvidia-ocr.ts`, and `src/lib/server/workers.ts`.
- **Primary Engine**: **Google Gemini Vision** (`extractTextbookPage`).
  - **Models**: Auto-fallback model chain (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash` → `gemini-2.0-flash-lite` → `gemini-1.5-flash-8b`).
  - **SDK**: `@google/genai` with strict `responseSchema` JSON enforcement.
  - **Fallback behavior**: On 429 Quota Exhaustion or 503 Service Unavailability, instantly tries the next Gemini model in the chain before escalating to Nemotron.
- **Fallback / Default Engine**: **NVIDIA Nemotron OCR v2** (`runNemotronOcr`).
  - **Model**: `meta/llama-3.2-11b-vision-instruct`.
  - Triggered automatically if `GEMINI_API_KEY` is omitted or if the Gemini fallback chain is exhausted.
- **Extraction Contract**:
  1. Transcribes printed text into exercise items (`exerciseItems`).
  2. Restores blank tokens (`_____`) even when pencil handwriting is present.
  3. Reports handwriting presence (`hasHandwriting`) separately.
  4. Identifies picture cues (`pictureCue`), target words (`targetWord`), and target blends (`targetBlend`).
  5. Transcribes instruction blocks VERBATIM into `pageInstructions`.
  6. Captures available letter blend banks or word boxes into `availableBank`.

### Stage 3: Deterministic OCR Normalization & Safety Guards
- **Module**: `src/lib/server/ocr/normalize-ocr.ts` (Pure Application Code).
- **Functions**:
  - `cleanProseContent` & `isProseOrCommentaryLine`: Strips commentary wrappers (`"The image shows..."`, `"Overall,..."`, bullet headers `* **Title**`).
  - `validateAnswerHint`: Deterministically nullifies leaked prompt examples (e.g. `"(12th)"`) unless the hint text physically exists in the raw page text.
  - `isInstructionText`: Identifies activity directions (e.g. `"Complete each sentence..."`) and routes them to `pageInstructions` so they are **never** mapped into `declarativeFacts`.
  - `POSSIBLY_FILLED_FROM_HANDWRITING` Warning Flag: Automatically flags pages where blanks are missing or handwritten answers were detected.
  - `pageWordFamily` Aggregation: Collects all proposed answer choices across page exercise items to serve as distractors for `word_family_mc`.

### Stage 4: Human-in-the-Loop & Verification UI
- **Module**: `src/components/OcrVerification.tsx` & `OcrVerification.module.css`.
- **Role**: State-aware parent review interface:
  - **⚡ Click-to-Blank**: Converts filled answer words in text to `_____` with one click.
  - **✓ Blank Restored Confirm Chip**: Displays `Confirm ✓`, `Edit ✎`, and `Clear ✕` buttons whenever `_____` is detected in content.
  - **Warning Chips**: Displays `⚠ May be filled in from handwriting — verify the blank` to alert parents.
- **Guarantee**: Only parent-approved text (`included = true`) is stored in the verified snapshot (`verified_contents`).

### Stage 5: Verified Source Snapshot & Fact Isolation
- **Module**: `src/lib/server/validation/grounding.ts`.
- **Role**: Sentence-level extraction creates discrete, traceable atomic facts (`F1`, `F2`, ... `Fn`) tied to page labels. Meta-instructions (`pageInstructions`) are strictly excluded from source facts.

### Stage 6: Dual-Engine Reviewer Generation
- **Primary Engine**: **Gemini Grade 1 Reviewer** (`src/lib/server/ai/gemini-reviewer.ts`).
  - **Models**: Auto-fallback model chain (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash` → `gemini-2.0-flash-lite` → `gemini-1.5-flash-8b`).
  - **Features**: Generates structured Grade 1 phonics/sight-word questions with exact 3-option choices (`phonics_mc`), word-bank fill-in-the-blank items (`fill_blank`), and 5-to-8 word `parentExplanation` fields for every answer key item.
- **Fallback / Secondary Engine**: **NVIDIA Nemotron 3 Super 120B** (`src/lib/server/generation/generate-reviewer.ts`).
  - **Model**: `nvidia/nemotron-3-super-120b-a12b`.
  - **Stage 1 (Planning Pass)**: `buildPlanningUserPrompt` & `validateAndBalancePlan`. Enforces distribution across question types (`blend_mc`, `word_family_mc`, `first_letter_fill`, `fill_blank`, `tf_exact`, `tf_swap`, `reverse_id`). Enforces Null WordBank Guard.
  - **Stage 2 (Writing Pass)**: Generates candidate question JSON mapped to source facts (`sourceFactId`).

### Stage 7: Multi-Format Grounding & Validation Gate
- **Modules**: `validators.ts`, `grounding.ts`, `grade-profile.ts`, `duplicates.ts`.
- **Checks**:
  1. **Grounding Check**: `sourceFactId` existence and lexical answer support in source text.
  2. **Blank Token Match**: Regex `/(_\s*_|___+|\[\s*\]|[a-zA-Z]\s*_\s*_)/` supports standard blanks and first-letter clues (`b _ _ _ _`).
  3. **Word Bank & Word Family Containment**: `validateWordBankContainment` checks choice options against verified `wordBank` or falls back to `pageWordFamily`.
  4. **Grade 1 Language & Overlap**: Enforces Grade 1 vocabulary restrictions and checks for duplicate questions.
- **Regeneration & Discard**: Invalid questions enter a 1-pass regeneration loop with specific error context. Unresolved items are discarded (failure-closed).

### Stage 8: Final Reviewer, Derived Answer Key, & Dual PDF Export
- **Module**: `src/lib/server/pdf/generate-pdf.ts`.
- **Output**: Validated questions are grouped into printable sections with Roman numerals (`I. Fill in the Blank`, `II. Multiple Choice (Word Family)`, etc.).
- **Answer Key**: Derived directly from validated questions without separate AI inference, complete with parent explanations.

### Stage 9: Evals Harness & Parent Feedback Loop
- **Evals Suite**: `src/lib/server/evals/pipeline-eval.test.ts` with mock fixtures (`spelling-l-blends.json`, `long-i-ie.json`). Evaluates hallucination rejection, word bank containment, template guards, and blank restoration without LLM API costs.
- **Version Overlap Gate**: `checkVersionOverlap` flags >50% question overlap between exam versions to ensure parent reviewers stay fresh.
- **Parent Feedback Loop**: `POST /api/exam/[examId]/feedback` logs parent question deletions and feedback reasons to `question_feedback` in PostgreSQL.
