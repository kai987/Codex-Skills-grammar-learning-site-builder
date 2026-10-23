import { grammarReportSchema } from "@mvl/shared";

export const fixture = grammarReportSchema.parse({
  schemaVersion: "1.0.0",
  reportType: "multilingual-grammar-report",
  explanationLanguage: "zh-CN",
  languages: ["ja", "en", "zh-Hans"],
  source: {
    type: "subtitle",
    title: "合成作品",
  },
  analysis: {
    model: "mock-grammar-analyzer",
    modelConfigurationHash: "fixture-v1",
    analyzerVersion: "1.0.0",
    generatedAt: "2026-07-22T00:00:00.000Z",
  },
  summary: {
    sentenceCount: 1,
    grammarPointCount: 1,
    languageCounts: {
      ja: 1,
    },
    levelCounts: {
      "JLPT:N5": 1,
    },
  },
  sentences: [
    {
      id: "sentence-0001",
      cueIds: ["cue-0001"],
      start: 0.2,
      end: 0.9,
      language: "ja",
      languages: ["ja"],
      text: "これは何ですか？",
      reading: "これはなんですか？",
      translation: "这是什么？",
      previousSentenceId: null,
      nextSentenceId: null,
      reconstructionConfidence: 0.99,
      needsReview: false,
      grammar: [
        {
          id: "grammar-0001",
          language: "ja",
          surface: "何ですか",
          pattern: "～は何ですか",
          category: "question",
          formation: "名詞＋は＋何＋ですか",
          meaning: "……是什么？",
          explanation: "用于礼貌地询问事物的名称或性质。",
          nuance: "礼貌疑问表达。",
          context: null,
          examples: [
            {
              text: "あの建物は何ですか？",
              reading: "あのたてものはなんですか？",
              translation: "那座建筑是什么？",
            },
          ],
          levelSystem: "JLPT",
          level: "N5",
          confidence: 0.97,
        },
      ],
      vocabulary: [],
    },
  ],
});
