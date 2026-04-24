/**
 * Output utilities — ANSI color constants and match-finding/highlighting functions.
 */

import { tokenizePattern } from "./tokenizer.ts";
import { matchTokensLengthAt, matchTokensLengthAtEnd } from "./matcher.ts";

export const ANSI_COLOR_OPEN = "\x1b[01;31m";
export const ANSI_COLOR_CLOSE = "\x1b[m";

/**
 * Find the next matching text in an input line, starting from a given index.
 * @param inputLine The line of input to search.
 * @param pattern The pattern to match.
 * @param searchFrom The index from which to start searching.
 * @returns The start index and length of the match, or null if no match.
 */
export function findNextMatch(inputLine: string, pattern: string, searchFrom: number): { start: number; length: number } | null {
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
