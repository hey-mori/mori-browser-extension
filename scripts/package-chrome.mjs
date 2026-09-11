#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  defaultChromePackagePaths,
  stageChromePackage,
  writeChromeZip,
} from "./lib/chromePackage.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const paths = defaultChromePackagePaths(root);

stageChromePackage({ root, stagingDir: paths.stagingDir });
writeChromeZip({ root: paths.stagingDir, zipPath: paths.zipPath });

console.log(
  JSON.stringify(
    {
      stagingDir: paths.stagingDir,
      zipPath: paths.zipPath,
    },
    null,
    2,
  ),
);
