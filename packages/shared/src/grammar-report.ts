import { z } from "zod";

import { languageTagSchema } from "./language.js";

export const schemaVersionSchema = z.literal("1.0.0");

export const grammarLevelSystemSchema = z.enum([
  "JLPT",
  "HSK",
  "CEFR",
  "unknown",
]);

const grammarExampleSchema = z
  .object({
    text: z.string().min(1),
    reading: z.string().min(1).nullable(),
    translation: z.string().min(1).nullable(),
  })
  .strict();

const grammarPointSchema = z
  .object({
    id: z.string().min(1),
    language: languageTagSchema,
    surface: z.string().min(1),
    pattern: z.string().min(1),
    category: z.string().min(1),
    formation: z.string().min(1),
    meaning: z.string().min(1),
    explanation: z.string().min(1),
    nuance: z.string().min(1).nullable(),
    context: z.string().min(1).nullable(),
    examples: z.array(grammarExampleSchema).min(1).max(1),
    levelSystem: grammarLevelSystemSchema,
    level: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const vocabularyItemSchema = z
  .object({
    surface: z.string().min(1),
    language: languageTagSchema,
    reading: z.string().min(1).nullable(),
    meaning: z.string().min(1),
  })
  .strict();

const grammarSentenceSchema = z
  .object({
    id: z.string().min(1),
    cueIds: z.array(z.string().min(1)),
    start: z.number().nonnegative().nullable(),
    end: z.number().positive().nullable(),
    language: languageTagSchema,
    languages: z.array(languageTagSchema).min(1),
    text: z.string().min(1),
    reading: z.string().min(1).nullable(),
    translation: z.string().min(1).nullable(),
    previousSentenceId: z.string().min(1).nullable(),
    nextSentenceId: z.string().min(1).nullable(),
    reconstructionConfidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
    grammar: z.array(grammarPointSchema),
    vocabulary: z.array(vocabularyItemSchema),
  })
  .strict()
  .refine(
    (sentence) =>
      sentence.start === null ||
      sentence.end === null ||
      sentence.end > sentence.start,
    { message: "Sentence end must be greater than start." },
  );

export const grammarReportSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    reportType: z.literal("multilingual-grammar-report"),
    explanationLanguage: z.enum(["zh-CN", "ja-JP", "en"]),
    languages: z.array(languageTagSchema),
    source: z
      .object({
        type: z.enum(["subtitle", "text", "subtitle-package"]),
        title: z.string().min(1).nullable(),
      })
      .strict(),
    analysis: z
      .object({
        model: z.string().min(1),
        modelConfigurationHash: z.string().min(1),
        analyzerVersion: z.string().min(1),
        generatedAt: z.iso.datetime(),
      })
      .strict(),
    summary: z
      .object({
        sentenceCount: z.number().int().nonnegative(),
        grammarPointCount: z.number().int().nonnegative(),
        languageCounts: z.record(z.string(), z.number().int().nonnegative()),
        levelCounts: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    sentences: z.array(grammarSentenceSchema),
  })
  .strict();

export type GrammarReport = z.infer<typeof grammarReportSchema>;
