import type { GrammarReport } from "@mvl/shared";

// Presentation-only projection. The source report and copied JSON remain intact.
export function createLearningReport(source: GrammarReport): GrammarReport {
  const eligible = source.sentences.filter(
    (sentence) => sentence.grammar.length > 0,
  );
  const sentences = eligible.map((sentence, index) => ({
    ...sentence,
    previousSentenceId: eligible[index - 1]?.id ?? null,
    nextSentenceId: eligible[index + 1]?.id ?? null,
  }));
  const languageCounts: GrammarReport["summary"]["languageCounts"] = {};
  const levelCounts: GrammarReport["summary"]["levelCounts"] = {};
  let grammarPointCount = 0;
  for (const sentence of sentences) {
    languageCounts[sentence.language] =
      (languageCounts[sentence.language] ?? 0) + 1;
    for (const grammar of sentence.grammar) {
      const key = `${grammar.levelSystem}:${grammar.level}`;
      levelCounts[key] = (levelCounts[key] ?? 0) + 1;
      grammarPointCount += 1;
    }
  }
  return {
    ...source,
    languages: [
      ...new Set(sentences.flatMap((sentence) => sentence.languages)),
    ],
    sentences,
    summary: {
      sentenceCount: sentences.length,
      grammarPointCount,
      languageCounts,
      levelCounts,
    },
  };
}

export interface BuildManifest {
  schemaVersion: "1.0.0";
  buildType: "multilingual-grammar-learning-site";
  builtAt: string;
  reportRelativePath: string;
  reportSha256: string;
  videoRelativePath: string | null;
  uiLanguages: ["zh-CN", "ja-JP", "en"];
}

export async function loadSiteData(): Promise<{
  report: GrammarReport;
  manifest: BuildManifest;
}> {
  const [reportResponse, manifestResponse] = await Promise.all([
    fetch("./data/grammar-report.json"),
    fetch("./data/build-manifest.json"),
  ]);
  if (!reportResponse.ok || !manifestResponse.ok) {
    throw new Error(
      `Static data failed to load (${reportResponse.status}/${manifestResponse.status}).`,
    );
  }
  return {
    report: createLearningReport(
      (await reportResponse.json()) as GrammarReport,
    ),
    manifest: (await manifestResponse.json()) as BuildManifest,
  };
}
