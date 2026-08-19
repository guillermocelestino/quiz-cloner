# AI Textbook-to-Reviewer Architecture

## Visual Architecture Diagram

```
                         AI TEXTBOOK-TO-REVIEWER
                                   │
                                   ▼
                            ┌─────────────┐
                            │   PARENT    │
                            └──────┬──────┘
                                   │
                                   ▼
                        ┌────────────────────┐
                        │  CREATE STUDENT    │
                        │  Grade 1           │
                        └─────────┬──────────┘
                                   │
                                   ▼
                        ┌────────────────────┐
                        │  CREATE EXAM PREP  │
                        │  Subject: Science  │
                        │  Pages: 42–71      │
                        └─────────┬──────────┘
                                   │
                                   ▼
                   ┌─────────────────────────────┐
                   │      TEXTBOOK PAGES         │
                   │  Page 42, 43, ..., Page 71  │
                   │  Uploaded page images       │
                   └──────────────┬──────────────┘
                                  │
                     ┌────────────┴────────────┐
                     │                         │
                     ▼                         ▼
           ┌──────────────────┐       ┌──────────────────┐
           │   PDF BUILDER    │       │  ORIGINAL PAGE   │
           │  (Optional PDF)  │       │     IMAGES       │
           │ Viewable asset   │       └────────┬─────────┘
           │ NOT fed to AI    │                │
           └────────┬─────────┘                ▼
                    │                 ┌──────────────────┐
                    ▼                 │  SHARP OPTIMIZER │
           ┌──────────────────┐       │ (1400px JPEG)    │
           │   TEXTBOOK PDF   │       └────────┬─────────┘
           │ (Offline View)   │                │
           └──────────────────┘                ▼
                                      ┌──────────────────┐
                                      │ AI ENGINE ROUTER │
                                      │(GEMINI_API_KEY?) │
                                      └────┬────────┬────┘
                                           │        │
                                   PRIMARY │        │ FALLBACK
                                  (Gemini) │        │ (Nemotron)
                                           ▼        ▼
                                ┌────────────┐    ┌──────────────────┐
                                │ GEMINI     │    │ NEMOTRON VISION  │
                                │ VISION OCR │    │      OCR v2      │
                                └─────┬──────┘    └────────┬─────────┘
                                      │                    │
                                      └─────────┬──────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │  OCR NORMALIZER  │
                                       │  (Deterministic) │
                                       │ Prose stripping  │
                                       │ Hint validation  │
                                       │ Instruction sep. │
                                       └────────┬─────────┘
                                                │
                                                ▼
                                 ┌──────────────────────────┐
                                 │   PARENT VERIFICATION    │
                                 │  (State-Aware UI)        │
                                 │  ⚡ Click-to-Blank       │
                                 │  ✓ Blank Restored Chip   │
                                 │  ⚠ Handwriting warning   │
                                 └────────────┬─────────────┘
                                              │ ONLY VERIFIED CONTENT
                                              ▼
                                 ┌──────────────────────────┐
                                 │  VERIFIED SNAPSHOT & DB  │
                                 │  (verified_contents)     │
                                 │  firstLetterClue,        │
                                 │  letterCount, answerHint,│
                                 │  handwrittenAnswer       │
                                 └────────────┬─────────────┘
                                              │
                                              ▼
                                 ┌──────────────────────────┐
                                 │ REVIEWER CONFIGURATION   │
                                 │ Subject / Grade / Count  │
                                 │ Multi-Format Templates:  │
                                 │ blend_mc, word_family_mc,│
                                 │ first_letter_fill, etc.  │
                                 └────────────┬─────────────┘
                                              │
                                              ▼
                                 ┌──────────────────────────┐
                                 │   AI GENERATION ROUTER   │
                                 │   (GEMINI_API_KEY ?)     │
                                 └──────┬────────────┬──────┘
                                        │            │
                                PRIMARY │            │ FALLBACK
                               (Gemini) │            │ (Nemotron)
                                        ▼            ▼
                             ┌──────────────┐    ┌──────────────────────────┐
                             │ GEMINI GRADE │    │   TWO-STAGE AI PASS      │
                             │  1 REVIEWER  │    │  NVIDIA Nemotron 120B    │
                             └──────┬───────┘    └───────────┬──────────────┘
                                    │                        │
                                    └───────────┬────────────┘
                                                │
                                                ▼
                                   ┌──────────────────────────┐
                                   │    MULTI-FORMAT GATE     │
                                   │ Grounding check,         │
                                   │ Blank token regex,       │
                                   │ Word family containment, │
                                   │ Version overlap (>50%)   │
                                   └──────┬────────────┬──────┘
                                          │            │
                                ✓ Accept  │            │  ✗ Reject / Regen
                                          ▼            ▼
                        ┌────────────────────┐      ┌──────────────────────────┐
                        │  VALIDATED         │      │ REJECTED QUESTION        │
                        │  QUESTIONS         │      │ 1 Regen pass with reason │
                        │ Grounded & Grade-1 │      │ Discard if still invalid │
                        └──────────┬─────────┘      └──────────────────────────┘
                                   │
                                   ├─────────────────────────┐
                                   │                         │
                                   ▼                         ▼
                        ┌────────────────────┐    ┌────────────────────┐
                        │  FINAL REVIEWER    │    │    ANSWER KEY      │
                        │ Printable          │    │ Derived directly   │
                        │ multi-format items │    │ from validated Qs │
                        └──────────┬─────────┘    └──────────┬─────────┘
                                   │                         │
                                   └────────────┬────────────┘
                                                │
                                                ▼
                                   ┌──────────────────────────┐
                                   │    PDF EXPORT & EVALS    │
                                   │  Reviewer.pdf / Key.pdf  │
                                   │  Vitest Eval Suite       │
                                   │  Parent Feedback Loop    │
                                   └──────────────────────────┘
```

---

## Architectural Principles & Component Breakdown

### 1. User Actions & Setup
- **Parent Management**: Initializing student profiles (Grade 1) and creating Exam Prep entries tied to a subject and textbook page range.
- **Textbook Page Capture**: Uploading original page images (JPEG, PNG, WebP) saved to local storage (`storage/uploads/...`) and stored in PostgreSQL (`pages` table).

### 2. Image Preprocessing & Dual Vision OCR
- **Image Optimization (`sharp`)**: Raw uploaded textbook page images are processed via `sharp` to constrain dimensions (max 1400x1400), flatten against white backgrounds (`#ffffff`), and compress to JPEG format at 80% quality (~150-250 KB payload size).
- **Dual Vision OCR Engine**:
  - **Primary**: Google Gemini Vision API (`extractTextbookPage` in `gemini-ocr.ts`) utilizing `@google/genai` structured JSON schema. Employs a 5-tier fallback model list (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash` → `gemini-2.0-flash-lite` → `gemini-1.5-flash-8b`) on quota limits or service interruptions.
  - **Fallback / Default**: NVIDIA Nemotron OCR v2 (`meta/llama-3.2-11b-vision-instruct` in `nvidia-ocr.ts`). Executes if `GEMINI_API_KEY` is omitted or if Gemini models fail.
- **Deterministic OCR Normalizer (`normalize-ocr.ts`)**:
  - `cleanProseContent` & `isProseOrCommentaryLine`: Strips vision model commentary wrappers (`"The image shows..."`, `"Overall,..."`, bullet headers `* **Title**`).
  - `validateAnswerHint`: Deterministically nullifies leaked prompt examples (e.g. `"(12th)"`) unless physically present on the raw page.
  - `isInstructionText`: Identifies activity directions and routes them to `pageInstructions` so they are **never** mapped into `declarativeFacts`.
  - `POSSIBLY_FILLED_FROM_HANDWRITING`: Flags pages where blanks are missing or handwritten answers were detected.

### 3. Human-in-the-Loop & State-Aware Verification UI
- **Side-by-Side Review**: Parents review original page images side-by-side with extracted content.
- **State-Aware UI (`OcrVerification.tsx`)**:
  - **⚡ Click-to-Blank**: Converts filled answer words in text to `_____` with one click.
  - **✓ Blank Restored Confirm Chip**: Renders `Confirm ✓`, `Edit ✎`, and `Clear ✕` buttons when `_____` is detected.
- **Strict Verification Boundary**: Only parent-verified text (`included = true`) is promoted to `verified_contents` table in PostgreSQL.

### 4. Verified Source Snapshot & Fact Extraction
- **Immutable Snapshot**: Verified text is locked into an immutable snapshot (`verified_snapshots` & `verified_contents`).
- **Atomic Fact Extraction (`grounding.ts`)**: Deterministically splits content into atomic source facts (`F1`, `F2`, ... `Fn`). Meta-instructions (`pageInstructions`) are strictly filtered out of source facts and passed as context only.

### 5. Dual-Engine Question Generation Architecture
- **Primary Generator (`gemini-reviewer.ts`)**: Google Gemini (`generateGrade1Reviewer`) with structured JSON schema output (`Type.OBJECT`). Generates Grade 1 phonics/sight-word questions with exact 3-option choices (`phonics_mc`), word-bank fill-in-the-blank items (`fill_blank`), and parent explanations (`parentExplanation`).
- **Fallback / Secondary Generator (`generate-reviewer.ts`)**: NVIDIA Nemotron 3 Super 120B (`nvidia/nemotron-3-super-120b-a12b`).
  - **Stage 1 (Planning Pass)**: `buildPlanningUserPrompt` & `validateAndBalancePlan`. Enforces distribution across question types (`blend_mc`, `word_family_mc`, `first_letter_fill`, `fill_blank`, `tf_exact`, `tf_swap`, `reverse_id`). Enforces Null WordBank Guard.
  - **Stage 2 (Writing Pass)**: Generates candidate question JSON mapped to source facts.

### 6. Grounding Validation & Quality Gate
- **Deterministic Validation Engine**:
  - **Grounding Check**: Verifies `sourceFactId` existence and lexical answer support in source text.
  - **Blank Token Match**: Regex `/(_\s*_|___+|\[\s*\]|[a-zA-Z]\s*_\s*_)/` validates standard blanks and first-letter clues (`b _ _ _ _`).
  - **Word Bank & Word Family Containment**: `validateWordBankContainment` checks choice options against verified `wordBank` or falls back to `pageWordFamily`.
  - **Version Overlap Gate**: `checkVersionOverlap` flags >50% overlap between reviewer versions.
- **Failure-Closed Regeneration**: Invalid questions enter a 1-pass targeted regeneration pass with error feedback. Discards unresolvable questions.

### 7. Dual PDF Export, Evals Harness, & Parent Feedback Loop
- **Dual PDF Export (`generate-pdf.ts`)**: Generates print-optimized worksheets (`Reviewer.pdf`) with Roman numeral section headers and derived answer keys (`Answer-Key.pdf`).
- **Evals Harness (`pipeline-eval.test.ts`)**: Vitest test suite with golden fixtures (`spelling-l-blends.json`, `long-i-ie.json`) evaluating pipeline performance without live API costs.
- **Parent Feedback Loop (`POST /api/exam/[examId]/feedback`)**: Logs parent question deletions and feedback reasons to `question_feedback` in PostgreSQL.

### 8. Multi-Engine Resilient Worker System
- **Worker Dispatcher (`src/lib/server/workers.ts`)**: Manages non-blocking async OCR (`runOcrForExamPrep`) and generation (`generateReviewerForExamPrep`) jobs.
- **Dynamic Routing**: Automatically checks for `process.env.GEMINI_API_KEY` at runtime. Prioritizes Gemini APIs for ultra-fast response times and structured JSON schema enforcement, while maintaining zero-downtime automatic fallback to NVIDIA Nemotron models.
