import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findGeneratedFiles } from "../../scripts/check-generated-files.mjs";

const script = path.resolve("scripts/check-generated-files.mjs");

describe("generated-file policy", () => {
  it.each([
    "output/site/index.html",
    "packages/demo/dist/index.js",
    "apps/demo/dist-types/index.d.ts",
    "cache/result.json",
    "src/.cache/result.json",
    "temp/work.txt",
    "node_modules/package/index.js",
    ".venv/bin/python",
    "src/__pycache__/module.pyc",
    "coverage/lcov.info",
    ".next/server/page.js",
    "apps/demo/.vite/deps.js",
    ".vitest/result.json",
    ".turbo/state",
    ".output/public/index.html",
    ".svelte-kit/output.js",
    ".astro/content.json",
    ".parcel-cache/state",
    ".pytest_cache/state",
    "nested/screenshots/mobile.png",
    "reports/analysis-manifest.json",
    "grammar-report.json",
    "grammar-report.md",
    "build-manifest.json",
    "node.tsbuildinfo",
    "trace.log",
    "bundle.js.map",
    ".eslintcache",
    ".prettiercache",
    ".DS_Store",
    "archive.zip",
    "video.mp4",
    "OUTPUT/日本語 with space.txt",
    "cache/line\nbreak.txt",
    "output",
    "node_modules",
    ".venv",
    "src/.cache",
  ])("rejects %s", (file) => {
    expect(findGeneratedFiles([file])).toHaveLength(1);
  });

  it("allows actual runtime sources, configuration, documentation, and synthetic fixtures", () => {
    expect(
      findGeneratedFiles([
        "src/build.ts",
        "src/cache.ts",
        "packages/site-builder-core/src/build.ts",
        "scripts/check-generated-files.mjs",
        ".github/workflows/ci.yml",
        ".gitignore",
        "package-lock.json",
        "README.ja.md",
        "schemas/grammar-report.schema.json",
        "apps/grammar-learning-site-template/index.html",
        "apps/grammar-learning-site-template/public/favicon.svg",
        "tests/fixtures/grammar-report.ts",
        "tests/fixtures/grammar-report.json",
        "docs/diagram.png",
      ]),
    ).toEqual([]);
  });

  it("checks committed files, ignores untracked build output, and rejects force-added artifacts", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "generated-files-test-"));
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: root, stdio: "pipe" });
    };
    const commit = (): void =>
      git(
        "-c",
        "user.name=CI Test",
        "-c",
        "user.email=ci@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "fixture",
      );
    const run = () =>
      spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    try {
      git("init", "--quiet");
      writeFileSync(path.join(root, ".gitignore"), "output/\n");
      writeFileSync(path.join(root, "README.md"), "Source fixture\n");
      mkdirSync(path.join(root, "src"));
      writeFileSync(path.join(root, "src", "index.ts"), "export {};\n");
      git("add", ".gitignore", "README.md", "src/index.ts");
      commit();
      mkdirSync(path.join(root, "output"));
      writeFileSync(
        path.join(root, "output", "日本語 with space.txt"),
        "Generated fixture\n",
      );
      expect(run().status).toBe(0);

      git("add", "--force", "output/日本語 with space.txt");
      commit();
      const rejected = run();
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("output/日本語 with space.txt");
      const fromSubdirectory = spawnSync(process.execPath, [script], {
        cwd: path.join(root, "src"),
        encoding: "utf8",
      });
      expect(fromSubdirectory.status).toBe(1);
      expect(fromSubdirectory.stderr).toContain("output/日本語 with space.txt");

      git("rm", "output/日本語 with space.txt");
      commit();
      expect(run().status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails rather than passing when there is no Git commit to inspect", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "generated-files-empty-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
      const result = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("could not inspect Git HEAD");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
