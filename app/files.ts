/**
 * File utilities — InputSource type and recursive directory collection.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

export type InputSource = { filePath: string | null; content: string };

/**
 * Recursively collect all file paths from a directory.
 * @param rootPath The root directory to start collecting files from.
 * @returns A promise that resolves to an array of file paths found within the directory and its subdirectories.
 */
export async function collectFilesRecursive(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursive(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}
