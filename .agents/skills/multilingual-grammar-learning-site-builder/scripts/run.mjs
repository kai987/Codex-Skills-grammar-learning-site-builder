#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const child = spawn(
  "npm",
  ["run", "build-learning-site", "--", ...process.argv.slice(2)],
  {
    cwd: repositoryRoot,
    shell: false,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
