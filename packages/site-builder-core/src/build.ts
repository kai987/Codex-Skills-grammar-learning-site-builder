import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRegularFile,
  atomicCopyFile,
  atomicWriteFile,
  atomicWriteJson,
  grammarReportSchema,
  OutputExistsError,
  pathExists,
  readJson,
  safeStem,
} from "@mvl/shared";
import { build } from "vite";

let templateBuildQueue: Promise<void> = Promise.resolve();

function enqueueTemplateBuild(
  operation: () => Promise<unknown>,
): Promise<void> {
  const queued = templateBuildQueue.then(async () => {
    await operation();
  });
  templateBuildQueue = queued.catch(() => undefined);
  return queued;
}

export interface LearningSiteOptions {
  inputReport: string;
  outputDirectory?: string;
  copyVideoPath?: string;
  overwrite?: boolean;
  now?: () => Date;
  templateDirectory?: string;
}

export interface LearningSiteResult {
  outputDirectory: string;
  siteDirectory: string;
  reportPath: string;
  buildManifestPath: string;
  videoPath: string | null;
}

export async function buildLearningSite(
  options: LearningSiteOptions,
): Promise<LearningSiteResult> {
  const now = options.now ?? (() => new Date());
  const inputReport = path.resolve(options.inputReport);
  await assertRegularFile(inputReport);
  const reportBytes = await readFile(inputReport);
  grammarReportSchema.parse(await readJson(inputReport));
  const analysisName = safeStem(path.basename(path.dirname(inputReport)));
  const outputDirectory = path.resolve(
    options.outputDirectory ?? path.join("output", analysisName),
  );
  const siteDirectory = path.join(outputDirectory, "site");
  const overwrite = options.overwrite ?? false;
  if (await pathExists(siteDirectory)) {
    if (!overwrite) throw new OutputExistsError(siteDirectory);
    await rm(siteDirectory, { recursive: true, force: true });
  }
  const templateDirectory =
    options.templateDirectory ??
    fileURLToPath(
      new URL("../../../apps/grammar-learning-site-template", import.meta.url),
    );
  await enqueueTemplateBuild(() =>
    build({
      root: templateDirectory,
      base: "./",
      logLevel: "warn",
      build: {
        outDir: siteDirectory,
        emptyOutDir: true,
        sourcemap: false,
      },
    }),
  );
  const reportPath = path.join(siteDirectory, "data/grammar-report.json");
  await atomicWriteFile(reportPath, reportBytes);
  let videoPath: string | null = null;
  let videoRelativePath: string | null = null;
  if (options.copyVideoPath !== undefined) {
    const sourceVideo = path.resolve(options.copyVideoPath);
    await assertRegularFile(sourceVideo);
    const fileName =
      safeStem(path.basename(sourceVideo, path.extname(sourceVideo))) +
      path.extname(sourceVideo).toLowerCase();
    videoPath = path.join(siteDirectory, "media", fileName);
    await atomicCopyFile(sourceVideo, videoPath);
    videoRelativePath = `./media/${fileName}`;
  }
  const buildManifestPath = path.join(
    siteDirectory,
    "data/build-manifest.json",
  );
  await atomicWriteJson(buildManifestPath, {
    schemaVersion: "1.0.0",
    buildType: "multilingual-grammar-learning-site",
    builtAt: now().toISOString(),
    reportRelativePath: "./data/grammar-report.json",
    reportSha256: createHash("sha256").update(reportBytes).digest("hex"),
    videoRelativePath,
    uiLanguages: ["zh-CN", "ja-JP", "en"],
  });
  await atomicWriteFile(
    path.join(siteDirectory, "README.txt"),
    [
      "Kotoba Atlas static learning site",
      "",
      "Serve this directory with any static HTTP server.",
      "The validated report is preserved byte-for-byte at data/grammar-report.json.",
      videoRelativePath === null
        ? "No video was copied. Use --copy-video explicitly to include one."
        : `Copied video: ${videoRelativePath}`,
      "",
    ].join("\n"),
  );
  return {
    outputDirectory,
    siteDirectory,
    reportPath,
    buildManifestPath,
    videoPath,
  };
}
