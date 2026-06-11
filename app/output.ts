/**
 * Output utilities — ANSI color constants and match-finding/highlighting functions.
 */

import { tokenizePattern, splitAlternatives } from "./tokenizer.ts";
import { matchTokensLengthAt, matchTokensLengthAtEnd } from "./matcher.ts";

export const ANSI_COLOR_OPEN = "\x1b[01;31m";
export const ANSI_COLOR_CLOSE = "\x1b[m";

/**
 * Scan a line for the first match of tokens at or after searchFrom.
 * @param inputLine The line of input to scan.
 * @param tokens The tokenized pattern to match.
 * @param searchFrom The index to start scanning from.
 * @param matchFn A function that returns the match length at a given position, or -1 for no match.
 * @returns The start index and length of the first match found, or null if none.
 */
function searchLine(
  inputLine: string,
  tokens: string[],
  searchFrom: number,
  matchFn: (input: string, tokens: string[], pos: number) => number,
): { start: number; length: number } | null {
  for (let i = searchFrom; i < inputLine.length; i++) {
    const matchLength = matchFn(inputLine, tokens, i);
    if (matchLength !== -1) {
      return { start: i, length: matchLength };
    }
  }
  return null;
}

/**
 * Find the next matching text in an input line, starting from a given index.
 * Top-level alternatives are tried independently; the leftmost (then longest) match wins.
 * @param inputLine The line of input to search.
 * @param pattern The pattern to match.
 * @param searchFrom The index from which to start searching.
 * @returns The start index and length of the match, or null if no match.
 */
export function findNextMatch(inputLine: string, pattern: string, searchFrom: number): { start: number; length: number } | null {
  const alternatives = splitAlternatives(pattern);
  if (alternatives.length > 1) {
    let best: { start: number; length: number } | null = null;
    for (const alternative of alternatives) {
      const match = findNextMatch(inputLine, alternative, searchFrom);
      if (match !== null && (best === null || match.start < best.start || (match.start === best.start && match.length > best.length))) {
        best = match;
      }
    }
    return best;
  }

  const hasStartAnchor = pattern.startsWith('^');
  const hasEndAnchor = pattern.endsWith('$');

  let cleanPattern = pattern;
  if (hasStartAnchor) cleanPattern = cleanPattern.slice(1);
  if (hasEndAnchor) cleanPattern = cleanPattern.slice(0, -1);

  const tokens = tokenizePattern(cleanPattern);
  const matchFn = hasEndAnchor ? matchTokensLengthAtEnd : matchTokensLengthAt;

  if (hasStartAnchor) {
    if (searchFrom > 0) return null;
    const len = matchFn(inputLine, tokens, 0);
    if (len !== -1) return { start: 0, length: len };
    return null;
  }

  return searchLine(inputLine, tokens, searchFrom, matchFn);
}

/**
 * Find all non-overlapping matching texts in an input line.
 * @param inputLine The line of input to search.
 * @param pattern The pattern to match.
 * @returns All matched substrings in left-to-right order.
 */
export function findAllMatchesText(inputLine: string, pattern: string): string[] {
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
export function highlightAllMatches(inputLine: string, pattern: string): string {
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
