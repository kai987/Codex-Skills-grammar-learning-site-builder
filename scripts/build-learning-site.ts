#!/usr/bin/env node

import { parseArgs } from "node:util";

import {
  buildLearningSite,
  type LearningSiteOptions,
} from "@mvl/site-builder-core";
import { InputError, toAppError } from "@mvl/shared";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      "copy-video": { type: "string" },
      overwrite: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.input === undefined) {
    throw new InputError("Missing required option: --input <path>");
  }

  const options: LearningSiteOptions = {
    inputReport: values.input,
    overwrite: values.overwrite,
  };
  if (values.output !== undefined) options.outputDirectory = values.output;
  if (values["copy-video"] !== undefined) {
    options.copyVideoPath = values["copy-video"];
  }

  const result = await buildLearningSite(options);
  console.log(
    JSON.stringify(
      {
        ok: true,
        outputDirectory: result.outputDirectory,
        siteDirectory: result.siteDirectory,
        report: result.reportPath,
        buildManifest: result.buildManifestPath,
        video: result.videoPath,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  const appError = toAppError(error);
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
      null,
      2,
    ),
  );
  process.exitCode = appError.exitCode;
});
