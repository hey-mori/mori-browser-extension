#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  defaultChromePackagePaths,
  inspectChromePackage,
} from "./lib/chromePackage.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const result = inspectChromePackage({ root, ...defaultChromePackagePaths(root) });

console.log(
  JSON.stringify(
    {
      packageInspection: "ok",
      files: result.files,
      zipEntries: result.zipEntries,
    },
    null,
    2,
  ),
);
