import { describe, expect, it } from "vitest";

import { createLearningReport } from "../../apps/grammar-learning-site-template/src/data.js";

import { fixture } from "../fixtures/grammar-report.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture entry");
  return value;
}

describe("grammar-only learning projection", () => {
  it("excludes empty grammar sentences and rebuilds counts and links without mutating source", () => {
    const source = structuredClone(fixture);
    source.sentences = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(required(fixture.sentences[0])),
      id: `sentence-${index}`,
      previousSentenceId: index === 0 ? null : `sentence-${index - 1}`,
      nextSentenceId: index === 4 ? null : `sentence-${index + 1}`,
      grammar:
        index % 2 === 0
          ? []
          : structuredClone(required(fixture.sentences[0]).grammar),
    }));
    required(source.sentences[0]).language = "und";
    required(source.sentences[0]).languages = ["und"];
    const before = JSON.stringify(source);
    const view = createLearningReport(source);
    expect(view.sentences.map((sentence) => sentence.id)).toEqual([
      "sentence-1",
      "sentence-3",
    ]);
    expect(
      view.sentences.map((sentence) => [
        sentence.previousSentenceId,
        sentence.nextSentenceId,
      ]),
    ).toEqual([
      [null, "sentence-3"],
      ["sentence-1", null],
    ]);
    expect(view.summary).toEqual({
      sentenceCount: 2,
      grammarPointCount: 2,
      languageCounts: { ja: 2 },
      levelCounts: { "JLPT:N5": 2 },
    });
    expect(view.languages).toEqual(["ja"]);
    expect(required(view.sentences[0]).start).toBe(
      required(source.sentences[1]).start,
    );
    expect(required(view.sentences[0]).grammar).toEqual(
      required(source.sentences[1]).grammar,
    );
    expect(JSON.stringify(source)).toBe(before);
  });

  it("returns an empty learning view when every sentence lacks grammar", () => {
    const source = structuredClone(fixture);
    required(source.sentences[0]).grammar = [];
    const view = createLearningReport(source);
    expect(view.sentences).toEqual([]);
    expect(view.languages).toEqual([]);
    expect(view.summary).toEqual({
      sentenceCount: 0,
      grammarPointCount: 0,
      languageCounts: {},
      levelCounts: {},
    });
    expect(source.sentences).toHaveLength(1);
  });

  it("keeps sentences with grammar even when optional learning details are absent", () => {
    const source = structuredClone(fixture);
    const sentence = required(source.sentences[0]);
    sentence.reading = null;
    sentence.translation = null;
    sentence.vocabulary = [];
    required(sentence.grammar[0]).examples = [];
    expect(createLearningReport(source).sentences).toEqual(source.sentences);
  });
});
