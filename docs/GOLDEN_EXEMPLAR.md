# Grade 1 Spelling & Phonics Golden Exemplar (L-Blends)

## Overview & Style Target
This exemplar defines the exact target style, vocabulary simplicity, question structure, and grounding standards for Grade 1 study reviewers.

---

## 1. Verified Source Context (Grade 1 Textbook - L-Blends)

### Declarative Facts:
- `[F1]` L-blends are consonant blends that end with the letter 'l'.
- `[F2]` Words like clock, flag, and plum start with L-blends.
- `[F3]` A clock tells us the time.
- `[F4]` A flag waves in the wind.
- `[F5]` A plum is a sweet purple fruit.

### Exercise Items:
- `[F6]` Item #1: "Look at the picture of a clock. Fill in the missing blend: (bl-, cl-, fl-, gl-, pl-, sl-) ____ock"
  - `blankToken`: "____"
  - `wordBank`: ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]
  - `pictureCue`: "clock showing 3:00"
  - `proposedAnswer`: "cl-"
- `[F7]` Item #2: "Look at the picture of a flag. Fill in the missing blend: (bl-, cl-, fl-, gl-, pl-, sl-) ____ag"
  - `blankToken`: "____"
  - `wordBank`: ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]
  - `pictureCue`: "flag blowing in wind"
  - `proposedAnswer`: "fl-"
- `[F8]` Item #3: "Look at the picture of a plum. Fill in the missing blend: (bl-, cl-, fl-, gl-, pl-, sl-) ____um"
  - `blankToken`: "____"
  - `wordBank`: ["bl-", "cl-", "fl-", "gl-", "pl-", "sl-"]
  - `pictureCue`: "purple plum on branch"
  - `proposedAnswer`: "pl-"

---

## 2. Ideal Reviewer Output (Target Questions)

```json
{
  "questions": [
    {
      "type": "blend_mc",
      "question": "Which blend completes the word for a picture of a clock? ____ock",
      "choices": ["bl-", "cl-", "fl-"],
      "answer": "cl-",
      "sourceFactId": "F6",
      "difficulty": "easy"
    },
    {
      "type": "fill_blank",
      "question": "A ____ waves in the wind.",
      "answer": "flag",
      "sourceFactId": "F4",
      "difficulty": "easy"
    },
    {
      "type": "tf_exact",
      "question": "True or False: A clock tells us the time.",
      "answer": "True",
      "sourceFactId": "F3",
      "difficulty": "easy"
    },
    {
      "type": "tf_swap",
      "question": "True or False: A plum waves in the wind.",
      "answer": "False",
      "sourceFactId": "F4",
      "difficulty": "normal"
    },
    {
      "type": "reverse_id",
      "question": "What sweet purple fruit starts with the blend 'pl-'?",
      "answer": "plum",
      "sourceFactId": "F5",
      "difficulty": "normal"
    }
  ]
}
```

---

## 3. Strict Execution Guidelines for AI Generation

1. **Word Bank Containment:** Every multiple-choice choice MUST be a member of the provided `wordBank` array (or `pageWordFamily` when `wordBank` is null).
2. **Strict Grounding:** Every statement in True/False or Fill-in-the-Blank must map directly to an explicit `DeclarativeFact` or `ExerciseItem`.
3. **True/False Swap Rules:** False statements (`tf_swap`) MUST be created strictly by swapping terms that exist elsewhere in the verified snapshot. Do NOT introduce outside words.
4. **Blank Token Integrity:** Fill-in-the-blank items MUST preserve exact sentence structure and blank tokens without solving or modifying surrounding words.

---

## Exemplar #2: Long-i (i_e) Phonics Reviewer (Multi-Format Generalization)

### 1. Verified Source Context (Grade 1 Textbook - Long-i i_e)

#### Declarative Facts:
- `[F9]` Words with the long-i sound often use the magic-e pattern (i_e).
- `[F10]` A bride gets married on her wedding day.
- `[F11]` A prize is won in a contest.
- `[F12]` The sun will shine brightly.

#### Exercise Items (Letter Boxes + First-Letter Clues, No Word Bank):
- `[F13]` Item #1: "Look at the picture of a bride. Fill in the letter boxes: b _ _ _ _"
  - `firstLetterClue`: "b"
  - `letterCount`: 5
  - `answerHint`: "(12th)"
  - `proposedAnswer`: "bride"
  - `wordBank`: null
- `[F14]` Item #2: "Look at the picture of a prize. Fill in the letter boxes: p _ _ _ _"
  - `firstLetterClue`: "p"
  - `letterCount`: 5
  - `answerHint`: "(reward)"
  - `proposedAnswer`: "prize"
  - `wordBank`: null
- `[F15]` Item #3: "Look at the picture of a price tag. Fill in the letter boxes: p _ _ _ _"
  - `firstLetterClue`: "p"
  - `letterCount`: 5
  - `answerHint`: "(cost)"
  - `proposedAnswer`: "price"
  - `wordBank`: null

---

### 2. Ideal Reviewer Output (Target Questions)

```json
{
  "questions": [
    {
      "type": "word_family_mc",
      "question": "Which long-i word means a woman getting married on her wedding day? b _ _ _ _",
      "choices": ["bride", "prize", "price"],
      "answer": "bride",
      "sourceFactId": "F13",
      "difficulty": "easy"
    },
    {
      "type": "first_letter_fill",
      "question": "A woman getting married is a b _ _ _ _.",
      "answer": "bride",
      "sourceFactId": "F13",
      "difficulty": "easy"
    },
    {
      "type": "tf_exact",
      "question": "True or False: A prize is won in a contest.",
      "answer": "True",
      "sourceFactId": "F11",
      "difficulty": "easy"
    },
    {
      "type": "tf_swap",
      "question": "True or False: A bride is won in a contest.",
      "answer": "False",
      "sourceFactId": "F11",
      "difficulty": "normal"
    }
  ]
}
```
