import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildLearningSite } from "@mvl/site-builder-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let temporaryRoot = "";

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "learning-site-test-"));
});

afterAll(async () => {
  if (temporaryRoot !== "") {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

describe("static learning site build", () => {
  it("preserves report bytes and ships the responsive UX controls", async () => {
    const inputReport = path.join(temporaryRoot, "grammar-report.json");
    await writeFile(
      inputReport,
      `${JSON.stringify(
        {
          schemaVersion: "1.0.0",
          reportType: "multilingual-grammar-report",
          explanationLanguage: "zh-CN",
          languages: ["ja"],
          source: { type: "subtitle", title: "Fixture" },
          analysis: {
            model: "test-analyzer",
            modelConfigurationHash: "fixture-v1",
            analyzerVersion: "1.0.0",
            generatedAt: "2026-08-16T00:00:00.000Z",
          },
          summary: {
            sentenceCount: 1,
            grammarPointCount: 1,
            languageCounts: { ja: 1 },
            levelCounts: { "JLPT:N5": 1 },
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
        },
        null,
        2,
      )}\n`,
    );
    const copiedVideo = path.join(temporaryRoot, "sample.mp4");
    await writeFile(copiedVideo, new Uint8Array([0, 1, 2, 3]));
    const outputDirectory = path.join(temporaryRoot, "analysis");

    const result = await buildLearningSite({
      inputReport,
      outputDirectory,
      copyVideoPath: copiedVideo,
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    });

    expect(await readFile(result.reportPath)).toEqual(
      await readFile(inputReport),
    );
    expect(result.videoPath).not.toBeNull();
    expect((await stat(result.videoPath ?? "missing")).size).toBe(4);

    const manifest = JSON.parse(
      await readFile(result.buildManifestPath, "utf8"),
    ) as {
      reportRelativePath: string;
      videoRelativePath: string | null;
    };
    expect(manifest.reportRelativePath).toBe("./data/grammar-report.json");
    expect(manifest.videoRelativePath).toBe("./media/sample.mp4");

    const assetDirectory = path.join(result.siteDirectory, "assets");
    const assetNames = await readdir(assetDirectory);
    const assetText = (
      await Promise.all(
        assetNames
          .filter((name) => /\.(?:css|js)$/u.test(name))
          .map((name) => readFile(path.join(assetDirectory, name), "utf8")),
      )
    ).join("\n");
    expect(assetText).toContain("mobile-reading-dock");
    expect(assetText).toContain("mobile-filter-toggle");
    expect(assetText).toContain("sentence-strip");

    await expect(
      buildLearningSite({ inputReport, outputDirectory }),
    ).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
  });
});
