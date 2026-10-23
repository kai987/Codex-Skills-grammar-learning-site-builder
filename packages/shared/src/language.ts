import { z } from "zod";

export const languageTagSchema = z.enum([
  "zh",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "en",
  "mixed",
  "und",
]);

export type LanguageTag = z.infer<typeof languageTagSchema>;
