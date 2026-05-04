/**
 * Quantifier parsers — parse {n}, {n,}, and {n,m} suffix quantifiers from tokens.
 */

/**
 * Parse a {n} exact quantifier suffix from a token.
 * Returns { base, n } if found, null otherwise.
 * @param token The token string to parse for an exact quantifier suffix.
 * @returns An object containing the base token and the exact number of repetitions if an exact quantifier is found, or null if not found.
 */
export function parseExactQuantifier(token: string): { base: string; n: number } | null {
  const match = /^(.*)\{(\d+)\}$/.exec(token);
  if (match) {
    return { base: match[1], n: Number.parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Parse a {n,} at-least quantifier suffix from a token.
 * Returns { base, n } if found, null otherwise.
 * @param token The token string to parse for an at-least quantifier suffix.
 * @returns An object containing the base token and the minimum number of repetitions if an at-least quantifier is found, or null if not found.
 */
export function parseAtLeastQuantifier(token: string): { base: string; n: number } | null {
  const match = /^(.*)\{(\d+),\}$/.exec(token);
  if (match) {
    return { base: match[1], n: Number.parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Parse a {n,m} range quantifier suffix from a token.
 * Returns { base, n, m } if found, null otherwise.
 * @param token The token string to parse for a range quantifier suffix.
 * @returns An object containing the base token and the minimum and maximum number of repetitions if a range quantifier is found, or null if not found.
 */
export function parseRangeQuantifier(token: string): { base: string; n: number; m: number } | null {
  const match = /^(.*)\{(\d+),(\d+)\}$/.exec(token);
  if (match) {
    return { base: match[1], n: Number.parseInt(match[2], 10), m: Number.parseInt(match[3], 10) };
  }
  return null;
}
