/**
 * Deterministic Structural Validation for Source-Reproduced Exercises (server-only).
 *
 * Validates that the reconstructed questionnaire faithfully reproduces the
 * source exercise structure with no invention, deletion, or transformation.
 */

import type {
  SourceReproducedExerciseItem,
  SourceReproducedOcr,
  ReconstructedExerciseItem,
} from "@/lib/types";
import type { ReconstructedExerciseItem as ReconstructedType } from "./reconstruct-exercise";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  itemNumber?: number;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  itemNumber?: number;
  field?: string;
}

/**
 * Validate the full reconstruction pipeline.
 * Checks source fidelity, answer removal, and structural integrity.
 */
export function validateReconstruction(
  sourceOcr: SourceReproducedOcr,
  reconstructed: ReconstructedType[]
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Question count validation
  validateQuestionCount(sourceOcr, reconstructed, errors, warnings);

  // 2. Exercise type validation
  validateExerciseTypes(sourceOcr, reconstructed, errors, warnings);

  // 3. Instructions preservation
  validateInstructions(sourceOcr, reconstructed, errors, warnings);

  // 4. Choices preservation
  validateChoices(sourceOcr, reconstructed, errors, warnings);

  // 5. Word bank preservation
  validateWordBank(sourceOcr, reconstructed, errors, warnings);

  // 6. Order preservation
  validateOrder(sourceOcr, reconstructed, errors, warnings);

  // 7. Source mapping (no invention)
  validateSourceMapping(sourceOcr, reconstructed, errors, warnings);

  // 8. Answer removal from questionnaire
  validateAnswerRemoval(sourceOcr, reconstructed, errors, warnings);

  // 9. Answer preservation for answer key
  validateAnswerPreservation(sourceOcr, reconstructed, errors, warnings);

  // 10. No new exercise types introduced
  validateNoNewExerciseTypes(sourceOcr, reconstructed, errors, warnings);

  // 11. Matching pairs preservation
  validateMatchingPairs(sourceOcr, reconstructed, errors, warnings);

  // 12. True/False not introduced unless in source
  validateTrueFalseNotIntroduced(sourceOcr, reconstructed, errors, warnings);

  // 13. Multiple choice not introduced unless in source
  validateMultipleChoiceNotIntroduced(sourceOcr, reconstructed, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 1. Question count must match exactly.
 */
function validateQuestionCount(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceCount = source.exerciseItems?.length ?? 0;
  const reconCount = reconstructed.length;

  if (sourceCount !== reconCount) {
    errors.push({
      code: "QUESTION_COUNT_MISMATCH",
      message: `Source has ${sourceCount} exercise items but reconstruction produced ${reconCount}`,
      field: "exerciseItems",
    });
  }
}

/**
 * 2. Each exercise type must match the source.
 */
function validateExerciseTypes(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];
  const reconMap = new Map(reconstructed.map((r) => [r.itemNumber, r]));

  for (const sourceItem of sourceItems) {
    const reconItem = reconMap.get(sourceItem.itemNumber);
    if (!reconItem) continue; // Handled by count validation

    if (sourceItem.exerciseType !== reconItem.exerciseType) {
      errors.push({
        code: "EXERCISE_TYPE_MISMATCH",
        message: `Item ${sourceItem.itemNumber}: source exercise type "${sourceItem.exerciseType}" but reconstruction has "${reconItem.exerciseType}"`,
        itemNumber: sourceItem.itemNumber,
        field: "exerciseType",
      });
    }
  }
}

/**
 * 3. Page instructions must be preserved.
 */
function validateInstructions(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceInstructions = source.pageInstructions ?? [];
  if (sourceInstructions.length === 0) return; // No instructions to validate

  // The questionnaire generation should include these
  // This is more of a generation-time check, but we validate the items have instructions field
  for (const sourceItem of source.exerciseItems ?? []) {
    const reconItem = reconstructed.find((r) => r.itemNumber === sourceItem.itemNumber);
    if (!reconItem) continue;

    if (sourceItem.instructions && sourceItem.instructions.trim()) {
      if (!reconItem.instructions || reconItem.instructions.trim() !== sourceItem.instructions.trim()) {
        warnings.push({
          code: "INSTRUCTIONS_DIFFER",
          message: `Item ${sourceItem.itemNumber}: item-specific instructions differ from source`,
          itemNumber: sourceItem.itemNumber,
          field: "instructions",
        });
      }
    }
  }
}

/**
 * 4. Multiple choice choices must remain unchanged (except answer markers).
 */
function validateChoices(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];
  const reconMap = new Map(reconstructed.map((r) => [r.itemNumber, r]));

  for (const sourceItem of sourceItems) {
    if (sourceItem.exerciseType !== "multiple_choice") continue;
    if (!sourceItem.choices || sourceItem.choices.length === 0) continue;

    const reconItem = reconMap.get(sourceItem.itemNumber);
    if (!reconItem || !reconItem.choices) {
      errors.push({
        code: "CHOICES_MISSING",
        message: `Item ${sourceItem.itemNumber}: source has choices but reconstruction is missing them`,
        itemNumber: sourceItem.itemNumber,
        field: "choices",
      });
      continue;
    }

    // Choices must match exactly (order and text)
    if (sourceItem.choices.length !== reconItem.choices.length) {
      errors.push({
        code: "CHOICES_COUNT_MISMATCH",
        message: `Item ${sourceItem.itemNumber}: source has ${sourceItem.choices.length} choices but reconstruction has ${reconItem.choices.length}`,
        itemNumber: sourceItem.itemNumber,
        field: "choices",
      });
      continue;
    }

    for (let i = 0; i < sourceItem.choices.length; i++) {
      if (sourceItem.choices[i] !== reconItem.choices[i]) {
        errors.push({
          code: "CHOICE_TEXT_MISMATCH",
          message: `Item ${sourceItem.itemNumber}, choice ${i + 1}: source "${sourceItem.choices[i]}" but reconstruction "${reconItem.choices[i]}"`,
          itemNumber: sourceItem.itemNumber,
          field: "choices",
        });
      }
    }
  }
}

/**
 * 5. Word bank must remain intact.
 */
function validateWordBank(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];
  const reconMap = new Map(reconstructed.map((r) => [r.itemNumber, r]));

  for (const sourceItem of sourceItems) {
    if (sourceItem.exerciseType !== "word_bank" && sourceItem.exerciseType !== "fill_blank") continue;
    if (!sourceItem.wordBank || sourceItem.wordBank.length === 0) continue;

    const reconItem = reconMap.get(sourceItem.itemNumber);
    if (!reconItem || !reconItem.wordBank) {
      errors.push({
        code: "WORD_BANK_MISSING",
        message: `Item ${sourceItem.itemNumber}: source has word bank but reconstruction is missing it`,
        itemNumber: sourceItem.itemNumber,
        field: "wordBank",
      });
      continue;
    }

    if (sourceItem.wordBank.length !== reconItem.wordBank.length) {
      errors.push({
        code: "WORD_BANK_COUNT_MISMATCH",
        message: `Item ${sourceItem.itemNumber}: source word bank has ${sourceItem.wordBank.length} words but reconstruction has ${reconItem.wordBank.length}`,
        itemNumber: sourceItem.itemNumber,
        field: "wordBank",
      });
      continue;
    }

    for (let i = 0; i < sourceItem.wordBank.length; i++) {
      if (sourceItem.wordBank[i] !== reconItem.wordBank[i]) {
        errors.push({
          code: "WORD_BANK_ITEM_MISMATCH",
          message: `Item ${sourceItem.itemNumber}, word bank ${i + 1}: source "${sourceItem.wordBank[i]}" but reconstruction "${reconItem.wordBank[i]}"`,
          itemNumber: sourceItem.itemNumber,
          field: "wordBank",
        });
      }
    }
  }

  // Also validate page-level availableBank
  if (source.availableBank && source.availableBank.length > 0) {
    // The page-level bank should be preserved in the questionnaire generation
    // This is checked at questionnaire generation time
  }
}

/**
 * 6. Question/item order must be preserved.
 */
function validateOrder(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];

  for (let i = 0; i < sourceItems.length; i++) {
    const sourceItem = sourceItems[i];
    const reconItem = reconstructed[i];

    if (!reconItem) continue;

    if (sourceItem.sourceOrder !== reconItem.sourceOrder) {
      errors.push({
        code: "ORDER_MISMATCH",
        message: `Position ${i + 1}: source order ${sourceItem.sourceOrder} but reconstruction order ${reconItem.sourceOrder}`,
        itemNumber: sourceItem.itemNumber,
        field: "sourceOrder",
      });
    }

    if (sourceItem.itemNumber !== reconItem.itemNumber) {
      errors.push({
        code: "ITEM_NUMBER_MISMATCH",
        message: `Position ${i + 1}: source item number ${sourceItem.itemNumber} but reconstruction has ${reconItem.itemNumber}`,
        itemNumber: sourceItem.itemNumber,
        field: "itemNumber",
      });
    }
  }
}

/**
 * 7. Every reconstructed item must map to a source item (no invention).
 */
function validateSourceMapping(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItemNumbers = new Set((source.exerciseItems ?? []).map((it) => it.itemNumber));

  for (const reconItem of reconstructed) {
    if (!sourceItemNumbers.has(reconItem.itemNumber)) {
      errors.push({
        code: "INVENTED_QUESTION",
        message: `Reconstructed item ${reconItem.itemNumber} has no corresponding source item`,
        itemNumber: reconItem.itemNumber,
        field: "itemNumber",
      });
    }
  }
}

/**
 * 8. Answers must be removed from answer-bearing positions in questionnaire.
 */
function validateAnswerRemoval(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];
  const reconMap = new Map(reconstructed.map((r) => [r.itemNumber, r]));

  for (const sourceItem of sourceItems) {
    const reconItem = reconMap.get(sourceItem.itemNumber);
    if (!reconItem) continue;

    // Collect all detected answers from source
    const allAnswers: { value: string; location: string }[] = [
      ...(sourceItem.detectedAnswers ?? []).map((a) => ({ value: a.value, location: a.location })),
      ...(sourceItem.handwrittenAnswers ?? []).map((a) => ({ value: a.value, location: a.location })),
      ...(sourceItem.printedAnswers ?? []).map((a) => ({ value: a.value, location: a.location })),
    ];

    for (const answer of allAnswers) {
      if (answer.location === "blank" && answer.value.trim().length > 0) {
        // Check that the answer text does NOT appear in the questionnaire text at a blank position
        const answerText = answer.value.trim();
        if (reconItem.questionnaireText.includes(answerText)) {
          // Check if it's at a blank location (not in word bank or choices)
          const index = reconItem.questionnaireText.indexOf(answerText);
          const isAtBlank = reconItem.blankLocations.some(
            (blankPos) => index >= blankPos - 5 && index <= blankPos + 5
          );

          if (isAtBlank) {
            errors.push({
              code: "ANSWER_NOT_REMOVED_FROM_BLANK",
              message: `Item ${sourceItem.itemNumber}: Answer "${answerText}" still present in questionnaire at blank position`,
              itemNumber: sourceItem.itemNumber,
              field: "questionnaireText",
            });
          }
        }
      } else if (answer.location === "marker_text" && answer.value.trim().length > 0) {
        // Explicit answer markers should be removed
        const markerPatterns = [
          `Answer: ${answer.value}`,
          `Answer:${answer.value}`,
          `✓ ${answer.value}`,
          `* ${answer.value}`,
        ];

        for (const pattern of markerPatterns) {
          if (reconItem.questionnaireText.includes(pattern)) {
            errors.push({
              code: "ANSWER_MARKER_NOT_REMOVED",
              message: `Item ${sourceItem.itemNumber}: Answer marker "${pattern}" still present in questionnaire`,
              itemNumber: sourceItem.itemNumber,
              field: "questionnaireText",
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * 9. Answers must be preserved for the answer key.
 */
function validateAnswerPreservation(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];
  const reconMap = new Map(reconstructed.map((r) => [r.itemNumber, r]));

  for (const sourceItem of sourceItems) {
    const reconItem = reconMap.get(sourceItem.itemNumber);
    if (!reconItem) continue;

    // Count total answers in source
    const sourceAnswerCount =
      (sourceItem.detectedAnswers?.length ?? 0) +
      (sourceItem.handwrittenAnswers?.length ?? 0) +
      (sourceItem.printedAnswers?.length ?? 0);

    // Count preserved answers in reconstruction
    const preservedCount = reconItem.preservedAnswers.length;

    if (sourceAnswerCount > 0 && preservedCount === 0) {
      warnings.push({
        code: "NO_ANSWERS_PRESERVED",
        message: `Item ${sourceItem.itemNumber}: Source had ${sourceAnswerCount} detected answers but none preserved for answer key`,
        itemNumber: sourceItem.itemNumber,
        field: "preservedAnswers",
      });
    } else if (sourceAnswerCount !== preservedCount) {
      warnings.push({
        code: "ANSWER_COUNT_MISMATCH",
        message: `Item ${sourceItem.itemNumber}: Source had ${sourceAnswerCount} answers but ${preservedCount} preserved`,
        itemNumber: sourceItem.itemNumber,
        field: "preservedAnswers",
      });
    }
  }
}

/**
 * 10. No new exercise types introduced.
 */
function validateNoNewExerciseTypes(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceTypes = new Set((source.exerciseItems ?? []).map((it) => it.exerciseType));

  for (const reconItem of reconstructed) {
    if (!sourceTypes.has(reconItem.exerciseType)) {
      errors.push({
        code: "NEW_EXERCISE_TYPE_INTRODUCED",
        message: `Reconstruction introduced exercise type "${reconItem.exerciseType}" not present in source`,
        itemNumber: reconItem.itemNumber,
        field: "exerciseType",
      });
    }
  }
}

/**
 * 11. Matching pairs must be preserved.
 */
function validateMatchingPairs(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceItems = source.exerciseItems ?? [];
  const reconMap = new Map(reconstructed.map((r) => [r.itemNumber, r]));

  for (const sourceItem of sourceItems) {
    if (sourceItem.exerciseType !== "matching") continue;
    if (!sourceItem.matchingPairs || sourceItem.matchingPairs.length === 0) continue;

    const reconItem = reconMap.get(sourceItem.itemNumber);
    if (!reconItem || !reconItem.matchingPairs) {
      errors.push({
        code: "MATCHING_PAIRS_MISSING",
        message: `Item ${sourceItem.itemNumber}: source has matching pairs but reconstruction is missing them`,
        itemNumber: sourceItem.itemNumber,
        field: "matchingPairs",
      });
      continue;
    }

    if (sourceItem.matchingPairs.length !== reconItem.matchingPairs.length) {
      errors.push({
        code: "MATCHING_PAIRS_COUNT_MISMATCH",
        message: `Item ${sourceItem.itemNumber}: source has ${sourceItem.matchingPairs.length} pairs but reconstruction has ${reconItem.matchingPairs.length}`,
        itemNumber: sourceItem.itemNumber,
        field: "matchingPairs",
      });
      continue;
    }

    for (let i = 0; i < sourceItem.matchingPairs.length; i++) {
      const src = sourceItem.matchingPairs[i];
      const rec = reconItem.matchingPairs[i];
      if (src.left !== rec.left || src.right !== rec.right) {
        errors.push({
          code: "MATCHING_PAIR_MISMATCH",
          message: `Item ${sourceItem.itemNumber}, pair ${i + 1}: source {left: "${src.left}", right: "${src.right}"} but reconstruction {left: "${rec.left}", right: "${rec.right}"}`,
          itemNumber: sourceItem.itemNumber,
          field: "matchingPairs",
        });
      }
    }
  }
}

/**
 * 12. True/False must not be introduced unless present in source.
 */
function validateTrueFalseNotIntroduced(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceHasTrueFalse = (source.exerciseItems ?? []).some(
    (it) => it.exerciseType === "true_false"
  );

  if (!sourceHasTrueFalse) {
    for (const reconItem of reconstructed) {
      if (reconItem.exerciseType === "true_false") {
        errors.push({
          code: "TRUE_FALSE_INTRODUCED",
          message: `True/False exercise type introduced but not present in source`,
          itemNumber: reconItem.itemNumber,
          field: "exerciseType",
        });
      }
    }
  }
}

/**
 * 13. Multiple choice must not be introduced unless present in source.
 */
function validateMultipleChoiceNotIntroduced(
  source: SourceReproducedOcr,
  reconstructed: ReconstructedType[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const sourceHasMultipleChoice = (source.exerciseItems ?? []).some(
    (it) => it.exerciseType === "multiple_choice"
  );

  if (!sourceHasMultipleChoice) {
    for (const reconItem of reconstructed) {
      if (reconItem.exerciseType === "multiple_choice") {
        errors.push({
          code: "MULTIPLE_CHOICE_INTRODUCED",
          message: `Multiple Choice exercise type introduced but not present in source`,
          itemNumber: reconItem.itemNumber,
          field: "exerciseType",
        });
      }
    }
  }
}