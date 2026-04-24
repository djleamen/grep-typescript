/**
 * Grep - A simple grep implementation in TypeScript.
 * From CodeCrafters.io build-your-own-grep (TypeScript).
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

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

type InputSource = { filePath: string | null; content: string };

/**
 * Recursively collect all file paths from a directory.
 * @param rootPath The root directory to start collecting files from.
 * @return A promise that resolves to an array of file paths found within the directory and its subdirectories.
 */
async function collectFilesRecursive(rootPath: string): Promise<string[]> {
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

const ANSI_COLOR_OPEN = "\x1b[01;31m";
const ANSI_COLOR_CLOSE = "\x1b[m";

/**
 * Tokenize a pattern into individual components.
 * @param pattern The pattern to tokenize.
 * @returns An array of tokens extracted from the pattern.
 */
function tokenizePattern(pattern: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  
  while (i < pattern.length) {
    let token = '';
    
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      token = pattern.slice(i, i + 2);
      i += 2;
    } else if (pattern[i] === '[') {
      const end = pattern.indexOf(']', i);
      if (end !== -1) {
        token = pattern.slice(i, end + 1);
        i = end + 1;
      } else {
        token = pattern[i];
        i++;
      }
    } else if (pattern[i] === '(') {
      let depth = 1;
      let end = i + 1;
      while (end < pattern.length && depth > 0) {
        if (pattern[end] === '(') depth++;
        else if (pattern[end] === ')') depth--;
        end++;
      }
      if (depth === 0) {
        token = pattern.slice(i, end);
        i = end;
      } else {
        token = pattern[i];
        i++;
      }
    } else {
      token = pattern[i];
      i++;
    }

    if (i < pattern.length && (pattern[i] === '+' || pattern[i] === '?' || pattern[i] === '*')) {
      token += pattern[i];
      i++;
    } else if (i < pattern.length && pattern[i] === '{') {
      const closeBrace = pattern.indexOf('}', i);
      if (closeBrace !== -1) {
        const inner = pattern.slice(i + 1, closeBrace);
        if (/^\d+$/.test(inner) || /^\d+,$/.test(inner) || /^\d+,\d+$/.test(inner)) {
          token += pattern.slice(i, closeBrace + 1);
          i = closeBrace + 1;
        }
      }
    }
    tokens.push(token);
  }
  return tokens;
}

/**
 * Count the number of opening parentheses in a token string.
 * Used to compute the correct group number for nested capturing groups.
 */
function countOpenParens(token: string): number {
  let count = 0;
  for (const ch of token) {
    if (ch === '(') count++;
  }
  return count;
}

/**
 * Check if a single character matches a single token.
 * @param char The character to match.
 * @param token The token to match against.
 * @returns True if the character matches the token, false otherwise.
 */
function matchToken(char: string, token: string): boolean {
  if (token === '\\d') {
    return char >= '0' && char <= '9';
  } else if (token === '\\w') {
    return (char >= 'a' && char <= 'z') ||
           (char >= 'A' && char <= 'Z') ||
           (char >= '0' && char <= '9') ||
           char === '_';
  } else if (token === '.') {
    return true;
  } else if (token.startsWith('[') && token.endsWith(']')) {
    const innerPattern = token.slice(1, -1);
    if (innerPattern.startsWith('^')) {
      const chars = innerPattern.slice(1);
      return !chars.includes(char);
    } else {
      return innerPattern.includes(char);
    }
  } else {
    return char === token;
  }
}

/**
 * Try to match a sequence of tokens starting from a specific position in the input.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The starting position in the input string.
 * @returns True if the sequence of tokens matches starting from the given position, false otherwise.
 */
function matchTokensAt(input: string, tokens: string[], startPos: number): boolean {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, false, []) !== -1;
}

/**
 * Try to match a sequence of tokens starting from a specific position in the input.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The starting position in the input string.
 * @returns Number of consumed characters if matched, otherwise -1.
 */
function matchTokensLengthAt(input: string, tokens: string[], startPos: number): number {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, false);
}

/**
 * Try to match a sequence of tokens starting from a specific position and ending at input end.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The starting position in the input string.
 * @returns Number of consumed characters if matched and ended at input end, otherwise -1.
 */
function matchTokensLengthAtEnd(input: string, tokens: string[], startPos: number): number {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, true);
}

/**
 * Parse a {n} exact quantifier suffix from a token.
 * Returns { base, n } if found, null otherwise.
 * @param token The token to parse for an exact quantifier.
 * @return An object containing the base token and the exact number of repetitions if the quantifier is found, or null if not found.
 */
function parseExactQuantifier(token: string): { base: string; n: number } | null {
  const match = token.match(/^(.*)\{(\d+)\}$/);
  if (match) {
    return { base: match[1], n: parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Parse a {n,} at-least quantifier suffix from a token.
 * Returns { base, n } if found, null otherwise.
 * @param token The token to parse for an at-least quantifier.
 * @return An object containing the base token and the minimum number of repetitions if the quantifier is found, or null if not found.
 */
function parseAtLeastQuantifier(token: string): { base: string; n: number } | null {
  const match = token.match(/^(.*)\{(\d+),\}$/);
  if (match) {
    return { base: match[1], n: parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Parse a {n,m} range quantifier suffix from a token.
 * Returns { base, n, m } if found, null otherwise.
 * @param token The token to parse for a range quantifier.
 * @return An object containing the base token, the minimum number of repetitions, and the maximum number of repetitions if the quantifier is found, or null if not found.
 */
function parseRangeQuantifier(token: string): { base: string; n: number; m: number } | null {
  const match = token.match(/^(.*)\{(\d+),(\d+)\}$/);
  if (match) {
    return { base: match[1], n: parseInt(match[2], 10), m: parseInt(match[3], 10) };
  }
  return null;
}

/**
 * Helper function to recursively match tokens and return consumed length.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param tokenIdx The current index in the tokens array.
 * @param inputPos The current position in the input string.
 * @param startPos The starting position of the match in the input string.
 * @param mustEndAtInputEnd Whether the match must end at the end of the input string.
 * @return The number of characters consumed if the tokens match, or -1 if they do not match.
 */
function matchTokensLengthHelper(
  input: string,
  tokens: string[],
  tokenIdx: number,
  inputPos: number,
  startPos: number,
  mustEndAtInputEnd: boolean,
  captures: (string | undefined)[] = [],
  groupOffset: number = 0,
): number {
  if (tokenIdx >= tokens.length) {
    if (mustEndAtInputEnd && inputPos !== input.length) {
      return -1;
    }
    return inputPos - startPos;
  }

  const token = tokens[tokenIdx];

  if (token.startsWith('(') && token.endsWith(')')) {
    const innerContent = token.slice(1, -1);
    const alternatives = splitAlternatives(innerContent);

    const precedingParens = tokens.slice(0, tokenIdx).reduce((sum, t) => sum + countOpenParens(t), 0);
    const groupNum = groupOffset + precedingParens + 1;
    const capturesBefore = captures.slice();

    for (const alternative of alternatives) {
      const altTokens = tokenizePattern(alternative);
      // Try all possible match lengths (greedy: longest first)
      for (let endPos = input.length; endPos >= inputPos; endPos--) {
        // Restore captures to pre-group state for each attempt
        captures.splice(0, captures.length, ...capturesBefore);
        const innerInput = input.slice(0, endPos);
        const innerResult = matchTokensLengthHelper(
          innerInput, altTokens, 0, inputPos, inputPos, true, captures, groupNum
        );
        if (innerResult !== -1) {
          captures[groupNum - 1] = input.slice(inputPos, endPos);
          const result = matchTokensLengthHelper(
            input, tokens, tokenIdx + 1, endPos, startPos, mustEndAtInputEnd, captures, groupOffset,
          );
          if (result !== -1) return result;
        }
      }
    }

    captures.splice(0, captures.length, ...capturesBefore);
    return -1;
  }

  if (token.startsWith('(') && (token.endsWith(')*') || token.endsWith(')+') || token.endsWith(')?'))) {
    const quantifier = token[token.length - 1];
    const innerContent = token.slice(1, -2);

    if (quantifier === '+') {
      const positions: number[] = [];
      let pos = inputPos;
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      if (positions.length === 0) return -1;
      for (let i = positions.length - 1; i >= 0; i--) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, positions[i], startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return -1;
    } else if (quantifier === '*') {
      const positions: number[] = [inputPos];
      let pos = inputPos;
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, positions[i], startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return -1;
    } else {
      const consumed = tryMatchGroupAtPos(input, innerContent, inputPos);
      if (consumed > 0) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, inputPos + consumed, startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return matchTokensLengthHelper(input, tokens, tokenIdx + 1, inputPos, startPos, mustEndAtInputEnd, captures, groupOffset);
    }
  }

  const exactQLH = parseExactQuantifier(token);
  if (exactQLH !== null) {
    const { base, n } = exactQLH;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return -1;
        pos += consumed;
      }
      return matchTokensLengthHelper(input, tokens, tokenIdx + 1, pos, startPos, mustEndAtInputEnd, captures, groupOffset);
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return -1;
        pos++;
      }
      return matchTokensLengthHelper(input, tokens, tokenIdx + 1, pos, startPos, mustEndAtInputEnd, captures, groupOffset);
    }
  }

  const atLeastQLH = parseAtLeastQuantifier(token);
  if (atLeastQLH !== null) {
    const { base, n } = atLeastQLH;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return -1;
        pos += consumed;
      }
      const positions: number[] = [pos];
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, positions[i], startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return -1;
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return -1;
        pos++;
      }
      while (pos < input.length && matchToken(input[pos], base)) pos++;
      for (let end = pos; end >= inputPos + n; end--) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, end, startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return -1;
    }
  }

  const rangeQLH = parseRangeQuantifier(token);
  if (rangeQLH !== null) {
    const { base, n, m } = rangeQLH;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return -1;
        pos += consumed;
      }
      const positions: number[] = [pos];
      for (let k = n; k < m; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, positions[i], startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return -1;
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return -1;
        pos++;
      }
      let maxPos = pos;
      for (let k = n; k < m && maxPos < input.length && matchToken(input[maxPos], base); k++) {
        maxPos++;
      }
      for (let end = maxPos; end >= pos; end--) {
        const result = matchTokensLengthHelper(input, tokens, tokenIdx + 1, end, startPos, mustEndAtInputEnd, captures, groupOffset);
        if (result !== -1) return result;
      }
      return -1;
    }
  }

  if (token.endsWith('+') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;

    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }

    if (matchCount === 0) {
      return -1;
    }

    for (let count = matchCount; count >= 1; count--) {
      const result = matchTokensLengthHelper(
        input,
        tokens,
        tokenIdx + 1,
        inputPos + count,
        startPos,
        mustEndAtInputEnd,
        captures,
        groupOffset,
      );
      if (result !== -1) {
        return result;
      }
    }

    return -1;
  } else if (token.endsWith('*') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;

    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }

    for (let count = matchCount; count >= 0; count--) {
      const result = matchTokensLengthHelper(
        input,
        tokens,
        tokenIdx + 1,
        inputPos + count,
        startPos,
        mustEndAtInputEnd,
        captures,
        groupOffset,
      );
      if (result !== -1) {
        return result;
      }
    }

    return -1;
  } else if (token.endsWith('?') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);

    if (inputPos < input.length && matchToken(input[inputPos], baseToken)) {
      const result = matchTokensLengthHelper(
        input,
        tokens,
        tokenIdx + 1,
        inputPos + 1,
        startPos,
        mustEndAtInputEnd,
        captures,
        groupOffset,
      );
      if (result !== -1) {
        return result;
      }
    }

    return matchTokensLengthHelper(
      input,
      tokens,
      tokenIdx + 1,
      inputPos,
      startPos,
      mustEndAtInputEnd,
      captures,
      groupOffset,
    );
  } else {
    // Handle backreferences \1-\9
    if (token.length === 2 && token[0] === '\\' && token[1] >= '1' && token[1] <= '9') {
      const groupNum = parseInt(token[1], 10);
      const capturedText = captures[groupNum - 1];
      if (capturedText === undefined) return -1;
      if (input.slice(inputPos, inputPos + capturedText.length) !== capturedText) return -1;
      return matchTokensLengthHelper(input, tokens, tokenIdx + 1, inputPos + capturedText.length, startPos, mustEndAtInputEnd, captures, groupOffset);
    }
    if (inputPos >= input.length) {
      return -1;
    }
    if (!matchToken(input[inputPos], token)) {
      return -1;
    }
    return matchTokensLengthHelper(
      input,
      tokens,
      tokenIdx + 1,
      inputPos + 1,
      startPos,
      mustEndAtInputEnd,
      captures,
      groupOffset,
    );
  }
}

/**
 * Helper function to recursively match tokens with backtracking support.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param tokenIdx The current index in the tokens array.
 * @param inputPos The current position in the input string.
 * @returns True if the tokens match starting from the given position, false otherwise.
 */
function matchTokensHelper(input: string, tokens: string[], tokenIdx: number, inputPos: number): boolean {
  if (tokenIdx >= tokens.length) {
    return true;
  }
  
  const token = tokens[tokenIdx];
  
  if (token.startsWith('(') && token.endsWith(')')) {
    const innerContent = token.slice(1, -1);
    const alternatives = splitAlternatives(innerContent);
    
    for (const alternative of alternatives) {
      const altTokens = tokenizePattern(alternative);
      const charsConsumed = matchAlternative(input, altTokens, inputPos);
      if (charsConsumed !== -1) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, inputPos + charsConsumed)) {
          return true;
        }
      }
    }
    return false;
  }

  if (token.startsWith('(') && (token.endsWith(')*') || token.endsWith(')+') || token.endsWith(')?'))) {
    const quantifier = token[token.length - 1];
    const innerContent = token.slice(1, -2);

    if (quantifier === '+') {
      const positions: number[] = [];
      let pos = inputPos;
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      if (positions.length === 0) return false;
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else if (quantifier === '*') {
      const positions: number[] = [inputPos];
      let pos = inputPos;
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else {
      const consumed = tryMatchGroupAtPos(input, innerContent, inputPos);
      if (consumed > 0) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, inputPos + consumed)) return true;
      }
      return matchTokensHelper(input, tokens, tokenIdx + 1, inputPos);
    }
  }

  const exactQH = parseExactQuantifier(token);
  if (exactQH !== null) {
    const { base, n } = exactQH;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return false;
        pos += consumed;
      }
      return matchTokensHelper(input, tokens, tokenIdx + 1, pos);
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return false;
        pos++;
      }
      return matchTokensHelper(input, tokens, tokenIdx + 1, pos);
    }
  }

  const atLeastQH = parseAtLeastQuantifier(token);
  if (atLeastQH !== null) {
    const { base, n } = atLeastQH;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return false;
        pos += consumed;
      }
      const positions: number[] = [pos];
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return false;
        pos++;
      }
      while (pos < input.length && matchToken(input[pos], base)) pos++;
      for (let end = pos; end >= inputPos + n; end--) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, end)) return true;
      }
      return false;
    }
  }

  const rangeQH = parseRangeQuantifier(token);
  if (rangeQH !== null) {
    const { base, n, m } = rangeQH;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return false;
        pos += consumed;
      }
      const positions: number[] = [pos];
      for (let k = n; k < m; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return false;
        pos++;
      }
      let maxPos = pos;
      for (let k = n; k < m && maxPos < input.length && matchToken(input[maxPos], base); k++) {
        maxPos++;
      }
      for (let end = maxPos; end >= pos; end--) {
        if (matchTokensHelper(input, tokens, tokenIdx + 1, end)) return true;
      }
      return false;
    }
  }
  
  if (token.endsWith('+') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;
    
    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }
    
    if (matchCount === 0) {
      return false;
    }
    
    for (let count = matchCount; count >= 1; count--) {
      if (matchTokensHelper(input, tokens, tokenIdx + 1, inputPos + count)) {
        return true;
      }
    }
    
    return false;
  } else if (token.endsWith('*') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;

    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }

    for (let count = matchCount; count >= 0; count--) {
      if (matchTokensHelper(input, tokens, tokenIdx + 1, inputPos + count)) {
        return true;
      }
    }

    return false;
  } else if (token.endsWith('?') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    
    if (inputPos < input.length && matchToken(input[inputPos], baseToken)) {
      if (matchTokensHelper(input, tokens, tokenIdx + 1, inputPos + 1)) {
        return true;
      }
    }
    
    return matchTokensHelper(input, tokens, tokenIdx + 1, inputPos);
  } else {
    if (inputPos >= input.length) {
      return false;
    }
    if (!matchToken(input[inputPos], token)) {
      return false;
    }
    return matchTokensHelper(input, tokens, tokenIdx + 1, inputPos + 1);
  }
}

/**
 * Split a pattern by | operator, respecting nested groups.
 * @param pattern The pattern string to split into alternatives.
 * @returns An array of alternative pattern strings extracted from the input pattern.
 */
function splitAlternatives(pattern: string): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;
  
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '(') {
      depth++;
      current += pattern[i];
    } else if (pattern[i] === ')') {
      depth--;
      current += pattern[i];
    } else if (pattern[i] === '|' && depth === 0) {
      alternatives.push(current);
      current = '';
    } else {
      current += pattern[i];
    }
  }
  alternatives.push(current);
  return alternatives;
}

/**
 * Check if an alternative matches starting at the given position.
 * Returns the number of characters consumed, or -1 if no match.
 * @param input The input string to match against.
 * @param altTokens The array of tokens representing the alternative to match.
 * @param startPos The starting position in the input string to attempt the match.
 * @returns The number of characters consumed if the alternative matches, or -1 if it does not match.
 */
function matchAlternative(input: string, altTokens: string[], startPos: number, groupOffset: number = 0, captures: (string | undefined)[] = []): number {
  return matchTokensLengthHelper(input, altTokens, 0, startPos, startPos, false, captures, groupOffset);
}

/**
 * Helper to match an alternative and track chars consumed.
 * @param input The input string to match against.
 * @param tokens The array of tokens representing the alternative to match.
 * @param tokenIdx The current index in the tokens array.
 * @param startPos The starting position of the match in the input string.
 * @param inputPos The current position in the input string.
 * @returns The number of characters consumed if the alternative matches, or -1 if it does not match.
 */
function matchAlternativeHelper(input: string, tokens: string[], tokenIdx: number, startPos: number, inputPos: number): number {
  if (tokenIdx >= tokens.length) {
    return inputPos - startPos;
  }
  
  const token = tokens[tokenIdx];

  const exactQA = parseExactQuantifier(token);
  if (exactQA !== null) {
    const { base, n } = exactQA;
    let pos = inputPos;
    for (let k = 0; k < n; k++) {
      if (pos >= input.length || !matchToken(input[pos], base)) return -1;
      pos++;
    }
    return matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, pos);
  }

  const atLeastQA = parseAtLeastQuantifier(token);
  if (atLeastQA !== null) {
    const { base, n } = atLeastQA;
    let pos = inputPos;
    for (let k = 0; k < n; k++) {
      if (pos >= input.length || !matchToken(input[pos], base)) return -1;
      pos++;
    }
    while (pos < input.length && matchToken(input[pos], base)) pos++;
    for (let end = pos; end >= inputPos + n; end--) {
      const result = matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, end);
      if (result !== -1) return result;
    }
    return -1;
  }

  const rangeQA = parseRangeQuantifier(token);
  if (rangeQA !== null) {
    const { base, n, m } = rangeQA;
    let pos = inputPos;
    for (let k = 0; k < n; k++) {
      if (pos >= input.length || !matchToken(input[pos], base)) return -1;
      pos++;
    }
    let maxPos = pos;
    for (let k = n; k < m && maxPos < input.length && matchToken(input[maxPos], base); k++) {
      maxPos++;
    }
    for (let end = maxPos; end >= pos; end--) {
      const result = matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, end);
      if (result !== -1) return result;
    }
    return -1;
  }
  
  if (token.endsWith('+') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;
    
    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }
    
    if (matchCount === 0) {
      return -1;
    }
    
    for (let count = matchCount; count >= 1; count--) {
      const result = matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, inputPos + count);
      if (result !== -1) {
        return result;
      }
    }
    
    return -1;
  } else if (token.endsWith('*') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;

    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }

    for (let count = matchCount; count >= 0; count--) {
      const result = matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, inputPos + count);
      if (result !== -1) {
        return result;
      }
    }

    return -1;
  } else if (token.endsWith('?') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    
    if (inputPos < input.length && matchToken(input[inputPos], baseToken)) {
      const result = matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, inputPos + 1);
      if (result !== -1) {
        return result;
      }
    }
    
    return matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, inputPos);
  } else {
    if (inputPos >= input.length) {
      return -1;
    }
    if (!matchToken(input[inputPos], token)) {
      return -1;
    }
    return matchAlternativeHelper(input, tokens, tokenIdx + 1, startPos, inputPos + 1);
  }
}

/**
 * Try to match a group (with alternatives) at a given position.
 * Returns the number of characters consumed, or -1 if no match.
 * @param input The input string to match against.
 * @param innerContent The inner content of the group to match.
 * @param inputPos The position in the input string to start matching from.
 * @returns The number of characters consumed if the group matches, or -1 if it does not match.
 */
function tryMatchGroupAtPos(input: string, innerContent: string, inputPos: number): number {
  const alternatives = splitAlternatives(innerContent);
  for (const alt of alternatives) {
    const altTokens = tokenizePattern(alt);
    const consumed = matchAlternative(input, altTokens, inputPos);
    if (consumed !== -1) return consumed;
  }
  return -1;
}

/**
 * Match the input line against the pattern, considering anchors and quantifiers.
 * @param inputLine The line of input to match against the pattern.
 * @param pattern The pattern to match against the input line.
 * @returns True if the input line matches the pattern, false otherwise.
 */
function matchPattern(inputLine: string, pattern: string): boolean {
  const hasStartAnchor = pattern.startsWith('^');
  const hasEndAnchor = pattern.endsWith('$');
  
  let cleanPattern = pattern;
  if (hasStartAnchor) {
    cleanPattern = cleanPattern.slice(1);
  }
  if (hasEndAnchor) {
    cleanPattern = cleanPattern.slice(0, -1);
  }
  
  const tokens = tokenizePattern(cleanPattern);
  
  if (hasStartAnchor && hasEndAnchor) {
    return matchTokensAtEnd(inputLine, tokens, 0);
  } else if (hasStartAnchor) {
    return matchTokensAt(inputLine, tokens, 0);
  } else if (hasEndAnchor) {
    for (let i = 0; i < inputLine.length; i++) {
      if (matchTokensAtEnd(inputLine, tokens, i)) {
        return true;
      }
    }
    return false;
  } else {
    for (let i = 0; i < inputLine.length; i++) {
      if (matchTokensAt(inputLine, tokens, i)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Find the next matching text in an input line, starting from a given index.
 * @param inputLine The line of input to search.
 * @param pattern The pattern to match.
 * @param searchFrom The index from which to start searching.
 * @returns The start index and length of the match, or null if no match.
 */
function findNextMatch(inputLine: string, pattern: string, searchFrom: number): { start: number; length: number } | null {
  const hasStartAnchor = pattern.startsWith('^');
  const hasEndAnchor = pattern.endsWith('$');

  let cleanPattern = pattern;
  if (hasStartAnchor) {
    cleanPattern = cleanPattern.slice(1);
  }
  if (hasEndAnchor) {
    cleanPattern = cleanPattern.slice(0, -1);
  }

  const tokens = tokenizePattern(cleanPattern);

  if (hasStartAnchor && hasEndAnchor) {
    if (searchFrom > 0) {
      return null;
    }
    const matchLength = matchTokensLengthAtEnd(inputLine, tokens, 0);
    if (matchLength !== -1) {
      return { start: 0, length: matchLength };
    }
    return null;
  }

  if (hasStartAnchor) {
    if (searchFrom > 0) {
      return null;
    }
    const matchLength = matchTokensLengthAt(inputLine, tokens, 0);
    if (matchLength !== -1) {
      return { start: 0, length: matchLength };
    }
    return null;
  }

  if (hasEndAnchor) {
    for (let i = searchFrom; i < inputLine.length; i++) {
      const matchLength = matchTokensLengthAtEnd(inputLine, tokens, i);
      if (matchLength !== -1) {
        return { start: i, length: matchLength };
      }
    }
    return null;
  }

  for (let i = searchFrom; i < inputLine.length; i++) {
    const matchLength = matchTokensLengthAt(inputLine, tokens, i);
    if (matchLength !== -1) {
      return { start: i, length: matchLength };
    }
  }

  return null;
}

/**
 * Find all non-overlapping matching texts in an input line.
 * @param inputLine The line of input to search.
 * @param pattern The pattern to match.
 * @returns All matched substrings in left-to-right order.
 */
function findAllMatchesText(inputLine: string, pattern: string): string[] {
  const matches: string[] = [];
  let searchFrom = 0;

  while (searchFrom <= inputLine.length) {
    const next = findNextMatch(inputLine, pattern, searchFrom);
    if (next === null) {
      break;
    }

    matches.push(inputLine.slice(next.start, next.start + next.length));

    if (next.length === 0) {
      searchFrom = next.start + 1;
    } else {
      searchFrom = next.start + next.length;
    }
  }

  return matches;
}

/**
 * Highlight all non-overlapping matches in a line using grep's default ANSI color style.
 * @param inputLine The line of input to search.
 * @param pattern The pattern to match.
 * @returns The input line with all matches highlighted.
 */
function highlightAllMatches(inputLine: string, pattern: string): string {
  let result = '';
  let cursor = 0;

  while (cursor <= inputLine.length) {
    const match = findNextMatch(inputLine, pattern, cursor);
    if (match === null) {
      break;
    }

    if (match.length === 0) {
      // Avoid infinite loops for zero-length matches.
      result += inputLine.slice(cursor, match.start + 1);
      cursor = match.start + 1;
      continue;
    }

    result += inputLine.slice(cursor, match.start);
    result += `${ANSI_COLOR_OPEN}${inputLine.slice(match.start, match.start + match.length)}${ANSI_COLOR_CLOSE}`;
    cursor = match.start + match.length;
  }

  result += inputLine.slice(cursor);
  return result;
}

/**
 * Check if tokens match starting from startPos and end exactly at the end of input.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The starting position in the input string.
 * @returns True if the tokens match and end at the end of the input, false otherwise.
 */
function matchTokensAtEnd(input: string, tokens: string[], startPos: number): boolean {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, true, []) !== -1;
}

/**
 * Recursive helper function to match tokens with backtracking support, 
 * ensuring the match ends at the end of the input.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param tokenIdx The current index in the tokens array.
 * @param inputPos The current position in the input string.
 * @returns True if the tokens match and reach the end of the input, false otherwise.
 */
function matchTokensHelperEnd(input: string, tokens: string[], tokenIdx: number, inputPos: number): boolean {
  if (tokenIdx >= tokens.length) {
    return inputPos === input.length;
  }
  
  const token = tokens[tokenIdx];
  
  if (token.startsWith('(') && token.endsWith(')')) {
    const innerContent = token.slice(1, -1);
    const alternatives = splitAlternatives(innerContent);
    
    for (const alternative of alternatives) {
      const altTokens = tokenizePattern(alternative);
      const charsConsumed = matchAlternative(input, altTokens, inputPos);
      if (charsConsumed !== -1) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos + charsConsumed)) {
          return true;
        }
      }
    }
    return false;
  }

  if (token.startsWith('(') && (token.endsWith(')*') || token.endsWith(')+') || token.endsWith(')?'))) {
    const quantifier = token[token.length - 1];
    const innerContent = token.slice(1, -2);

    if (quantifier === '+') {
      const positions: number[] = [];
      let pos = inputPos;
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      if (positions.length === 0) return false;
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else if (quantifier === '*') {
      const positions: number[] = [inputPos];
      let pos = inputPos;
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else {
      const consumed = tryMatchGroupAtPos(input, innerContent, inputPos);
      if (consumed > 0) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos + consumed)) return true;
      }
      return matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos);
    }
  }

  const exactQHE = parseExactQuantifier(token);
  if (exactQHE !== null) {
    const { base, n } = exactQHE;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return false;
        pos += consumed;
      }
      return matchTokensHelperEnd(input, tokens, tokenIdx + 1, pos);
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return false;
        pos++;
      }
      return matchTokensHelperEnd(input, tokens, tokenIdx + 1, pos);
    }
  }

  const atLeastQHE = parseAtLeastQuantifier(token);
  if (atLeastQHE !== null) {
    const { base, n } = atLeastQHE;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      const positions: number[] = [];
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return false;
        pos += consumed;
      }
      positions.push(pos);
      while (true) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return false;
        pos++;
      }
      while (pos < input.length && matchToken(input[pos], base)) pos++;
      for (let end = pos; end >= inputPos + n; end--) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, end)) return true;
      }
      return false;
    }
  }

  const rangeQHE = parseRangeQuantifier(token);
  if (rangeQHE !== null) {
    const { base, n, m } = rangeQHE;
    if (base.startsWith('(') && base.endsWith(')')) {
      const innerContent = base.slice(1, -1);
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed === -1) return false;
        pos += consumed;
      }
      const positions: number[] = [pos];
      for (let k = n; k < m; k++) {
        const consumed = tryMatchGroupAtPos(input, innerContent, pos);
        if (consumed <= 0) break;
        pos += consumed;
        positions.push(pos);
      }
      for (let i = positions.length - 1; i >= 0; i--) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, positions[i])) return true;
      }
      return false;
    } else {
      let pos = inputPos;
      for (let k = 0; k < n; k++) {
        if (pos >= input.length || !matchToken(input[pos], base)) return false;
        pos++;
      }
      let maxPos = pos;
      for (let k = n; k < m && maxPos < input.length && matchToken(input[maxPos], base); k++) {
        maxPos++;
      }
      for (let end = maxPos; end >= pos; end--) {
        if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, end)) return true;
      }
      return false;
    }
  }

  if (token.endsWith('+') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;
    
    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }
    
    if (matchCount === 0) {
      return false;
    }
    
    for (let count = matchCount; count >= 1; count--) {
      if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos + count)) {
        return true;
      }
    }
    return false;
  } else if (token.endsWith('*') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    let matchCount = 0;

    while (inputPos + matchCount < input.length && matchToken(input[inputPos + matchCount], baseToken)) {
      matchCount++;
    }

    for (let count = matchCount; count >= 0; count--) {
      if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos + count)) {
        return true;
      }
    }
    return false;
  } else if (token.endsWith('?') && !token.startsWith('(')) {
    const baseToken = token.slice(0, -1);
    
    if (inputPos < input.length && matchToken(input[inputPos], baseToken)) {
      if (matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos + 1)) {
        return true;
      }
    }
    return matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos);
  } else {
    if (inputPos >= input.length) {
      return false;
    }
    if (!matchToken(input[inputPos], token)) {
      return false;
    }
    return matchTokensHelperEnd(input, tokens, tokenIdx + 1, inputPos + 1);
  }
}

let anyMatch = false;
for (const source of inputSources) {
  const lines = source.content.split("\n");
  // Remove trailing empty string caused by a trailing newline
  if (lines.length > 0 && lines[lines.length - 1] === "") {
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
    } else {
      if (matchPattern(line, pattern)) {
        const outputLine = shouldColorize ? highlightAllMatches(line, pattern) : line;
        process.stdout.write(linePrefix + outputLine + "\n");
        anyMatch = true;
      }
    }
  }
}

process.exit(anyMatch ? 0 : 1);