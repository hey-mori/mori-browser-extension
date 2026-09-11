import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CHROME_PACKAGE_FILES = Object.freeze([
  "manifest.json",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "src/background.js",
  "src/backgroundController.js",
  "src/core/moriBrowserExtensionCore.js",
  "src/popup.css",
  "src/popup.html",
  "src/popup.js",
  "src/transport/nativeMessagingClient.js",
]);

export const PACKAGE_TEXT_EXTENSIONS = Object.freeze([".css", ".html", ".js", ".json"]);

export function readManifest(root) {
  return JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
}

export function defaultChromePackagePaths(root) {
  const manifest = readManifest(root);
  const version = manifest.version;
  const baseName = `mori-browser-extension-${version}`;
  const outputRoot = path.join(root, "dist", "chrome");
  return {
    outputRoot,
    stagingDir: path.join(outputRoot, baseName),
    zipPath: path.join(outputRoot, `${baseName}.zip`),
  };
}

export function stageChromePackage({ root, stagingDir }) {
  rmSync(stagingDir, { recursive: true, force: true });
  for (const file of CHROME_PACKAGE_FILES) {
    const source = path.join(root, file);
    const target = path.join(stagingDir, file);
    if (!existsSync(source)) throw new Error(`Package source missing: ${file}`);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

export function writeChromeZip({ root, zipPath, files = CHROME_PACKAGE_FILES }) {
  mkdirSync(path.dirname(zipPath), { recursive: true });
  const records = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const normalized = normalizePackagePath(file);
    const name = Buffer.from(normalized, "utf8");
    const content = readFileSync(path.join(root, normalized));
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    records.push(local, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(33, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, name);
    offset += local.length + name.length + content.length;
  }

  const centralSize = central.reduce((total, buffer) => total + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(zipPath, Buffer.concat([...records, ...central, end]));
}

export function inspectChromePackage({ root, stagingDir, zipPath }) {
  const stagingFiles = CHROME_PACKAGE_FILES.map((file) => normalizePackagePath(file));
  const zipEntries = readZipEntries(zipPath).map((entry) => entry.name);
  assert.deepEqual(zipEntries, stagingFiles, "zip entries must match the package allowlist");

  const manifest = readManifest(stagingDir);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "webNavigation", "nativeMessaging"]);
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(Object.keys(manifest.action.default_icon), ["16", "32", "48", "128"]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);

  for (const file of stagingFiles) {
    const stagedPath = path.join(stagingDir, file);
    if (!existsSync(stagedPath)) throw new Error(`Staged package file missing: ${file}`);
    if (PACKAGE_TEXT_EXTENSIONS.includes(path.extname(file))) {
      inspectPackagedText(file, readFileSync(stagedPath, "utf8"));
    }
  }

  return { files: stagingFiles, zipEntries };
}

export function readZipEntries(zipPath) {
  const buffer = readFileSync(zipPath);
  const endOffset = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "invalid zip central directory");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({
      name,
      crc: buffer.readUInt32LE(offset + 16),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function inspectPackagedText(file, text) {
  const forbidden = [
    [/eval\s*\(/, "eval"],
    [/new\s+Function\s*\(/, "new Function"],
    [/<script[^>]+src=["']https?:\/\//i, "remote script"],
    [/import\s*\(\s*["']https?:\/\//i, "remote dynamic import"],
    [/chrome-extension:\/\/[a-p]{32}\//i, "hard-coded extension id"],
    [/[A-Za-z]:\\dev\\/i, "local development path"],
    [/Co-Authored-By:/i, "co-author footer"],
    [/Claude-Session:/i, "Claude session footer"],
  ];

  for (const [pattern, label] of forbidden) {
    if (pattern.test(text)) throw new Error(`Packaged ${file} contains forbidden ${label}.`);
  }
}

function normalizePackagePath(file) {
  return file.replaceAll("\\", "/");
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end of central directory not found.");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
