/**
 * Grep - A simple grep implementation in TypeScript.
 * From CodeCrafters.io build-your-own-grep (TypeScript).
 */

import { collectFilesRecursive, type InputSource } from "./files.ts";
import { matchPattern } from "./matcher.ts";
import { findAllMatchesText, highlightAllMatches } from "./output.ts";

const args = process.argv;

const cliArgs = args.slice(2);
const onlyMatching = cliArgs.includes("-o");
const recursiveSearch = cliArgs.includes("-r");
const colorArg = cliArgs.find((arg) => arg.startsWith("--color="));
const colorMode = colorArg ? colorArg.slice("--color=".length) : null;
const shouldColorize =
  colorMode === "always" || (colorMode === "auto" && Boolean(process.stdout.isTTY));
const extendedFlagIndex = cliArgs.indexOf("-E");

if (extendedFlagIndex === -1 || extendedFlagIndex === cliArgs.length - 1) {
  console.log("Expected arguments to include '-E <pattern>'");
  process.exit(1);
}

const pattern = cliArgs[extendedFlagIndex + 1];

const filteredArgs = cliArgs.filter((arg, idx) => {
  if (idx === extendedFlagIndex || idx === extendedFlagIndex + 1) {
    return false;
  }
  if (arg === "-o") {
    return false;
  }
  if (arg === "-r") {
    return false;
  }
  if (arg.startsWith("--color=")) {
    return false;
  }
  return true;
});

const filePaths = filteredArgs;
const hasFileInput = filePaths.length > 0;
const shouldPrefixFileName = recursiveSearch || filePaths.length > 1;

let targetFilePaths: string[];
if (recursiveSearch) {
  const nestedFileLists = await Promise.all(filePaths.map((filePath) => collectFilesRecursive(filePath)));
  targetFilePaths = nestedFileLists.flat();
} else {
  targetFilePaths = filePaths;
}

const inputSources: InputSource[] = hasFileInput
  ? await Promise.all(
      targetFilePaths.map(async (filePath) => ({
        filePath,
        content: await Bun.file(filePath).text(),
      })),
    )
  : [{ filePath: null, content: await Bun.stdin.text() }];

let anyMatch = false;
for (const source of inputSources) {
  const lines = source.content.split("\n");
  // Remove trailing empty string caused by a trailing newline
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }

  for (const line of lines) {
    const linePrefix = shouldPrefixFileName && source.filePath !== null ? `${source.filePath}:` : "";

    if (onlyMatching) {
      const matchedTexts = findAllMatchesText(line, pattern);
      for (const matchedText of matchedTexts) {
        process.stdout.write(linePrefix + matchedText + "\n");
        anyMatch = true;
      }
    } else if (matchPattern(line, pattern)) {
      const outputLine = shouldColorize ? highlightAllMatches(line, pattern) : line;
      process.stdout.write(linePrefix + outputLine + "\n");
      anyMatch = true;
    }
  }
}

process.exit(anyMatch ? 0 : 1);