import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const generatedDirectories = new Set([
  "output",
  "outputs",
  "out",
  "dist",
  "dist-types",
  "build",
  "coverage",
  "cache",
  "caches",
  ".cache",
  "temp",
  "tmp",
  "node_modules",
  ".npm",
  ".npm-cache",
  ".pnpm-store",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".vite",
  ".vitest",
  ".turbo",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".parcel-cache",
  "playwright-report",
  "test-results",
  "screenshots",
]);
const generatedNames = new Set([
  ".ds_store",
  "thumbs.db",
  ".eslintcache",
  ".prettiercache",
  ".coverage",
  "lcov.info",
  "coverage-final.json",
]);
const generatedReports = new Set([
  "grammar-report.json",
  "grammar-report.md",
  "grammar-report.pipeline.json",
  "analysis-manifest.json",
  "build-manifest.json",
]);
const generatedExtension =
  /\.(?:tsbuildinfo|log|pyc|pyo|map|zip|tar|tgz|gz|bz2|xz|7z|rar|mp4|mkv|mov|webm|mp3|wav)$/i;

export function findGeneratedFiles(files) {
  return files.flatMap((file) => {
    const parts = file.toLowerCase().split("/");
    const name = parts.at(-1);
    const directory = parts.find((part) => generatedDirectories.has(part));
    let reason;
    if (directory) reason = `generated directory: ${directory}/`;
    else if (generatedNames.has(name)) reason = "cache or coverage metadata";
    else if (generatedExtension.test(name))
      reason = "generated, archive, or media file extension";
    else if (
      generatedReports.has(name) &&
      !file.startsWith("tests/fixtures/")
    ) {
      reason = "generated report or build manifest outside tests/fixtures/";
    }
    return reason ? [{ path: file, reason }] : [];
  });
}

export function checkGeneratedFiles(cwd = process.cwd()) {
  const files = execFileSync(
    "git",
    ["ls-tree", "--full-tree", "-r", "--name-only", "-z", "HEAD"],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
    .split("\0")
    .filter(Boolean);
  return { files, violations: findGeneratedFiles(files) };
}

function annotationText(value) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const { files, violations } = checkGeneratedFiles();
    if (violations.length === 0) {
      console.log(
        `Generated-file check passed: ${files.length} committed files inspected.`,
      );
    } else {
      console.error(
        "Generated files must not be committed. Remove these files from Git:",
      );
      for (const violation of violations) {
        const message = `${JSON.stringify(violation.path)}: ${violation.reason}`;
        console.error(`- ${message}`);
        if (process.env.GITHUB_ACTIONS === "true")
          console.error(`::error::${annotationText(message)}`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      "Generated-file check could not inspect Git HEAD:",
      error.message,
    );
    process.exitCode = 1;
  }
}
