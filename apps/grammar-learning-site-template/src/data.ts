import type { GrammarReport } from "@mvl/shared";

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
    report: (await reportResponse.json()) as GrammarReport,
    manifest: (await manifestResponse.json()) as BuildManifest,
  };
}
