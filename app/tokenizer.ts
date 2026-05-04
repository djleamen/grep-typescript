/**
 * Pattern tokenizer — splits a regex-like pattern string into tokens.
 */

function parseCharClass(pattern: string, i: number): [string, number] {
  const end = pattern.indexOf(']', i);
  if (end === -1) {
    return [pattern[i], i + 1];
  }
  return [pattern.slice(i, end + 1), end + 1];
}

function parseGroup(pattern: string, i: number): [string, number] {
  let depth = 1;
  let end = i + 1;
  while (end < pattern.length && depth > 0) {
    if (pattern[end] === '(') depth++;
    else if (pattern[end] === ')') depth--;
    end++;
  }
  if (depth === 0) {
    return [pattern.slice(i, end), end];
  }
  return [pattern[i], i + 1];
}

function parseNextToken(pattern: string, i: number): [string, number] {
  if (pattern[i] === '\\' && i + 1 < pattern.length) {
    return [pattern.slice(i, i + 2), i + 2];
  }
  if (pattern[i] === '[') return parseCharClass(pattern, i);
  if (pattern[i] === '(') return parseGroup(pattern, i);
  return [pattern[i], i + 1];
}

function isValidBraceQuantifier(inner: string): boolean {
  return /^\d+(,\d*)?$/.test(inner);
}

function appendBraceQuantifier(pattern: string, i: number, token: string): [string, number] {
  const closeBrace = pattern.indexOf('}', i);
  if (closeBrace !== -1) {
    const inner = pattern.slice(i + 1, closeBrace);
    if (isValidBraceQuantifier(inner)) {
      return [token + pattern.slice(i, closeBrace + 1), closeBrace + 1];
    }
  }
  return [token, i];
}

function appendQuantifierSuffix(pattern: string, i: number, token: string): [string, number] {
  if (i < pattern.length && ['*', '+', '?'].includes(pattern[i])) {
    return [token + pattern[i], i + 1];
  }
  if (i < pattern.length && pattern[i] === '{') {
    return appendBraceQuantifier(pattern, i, token);
  }
  return [token, i];
}

/**
 * Tokenize a pattern into individual components.
 * @param pattern The pattern to tokenize.
 * @returns An array of tokens extracted from the pattern.
 */
export function tokenizePattern(pattern: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    let [token, next] = parseNextToken(pattern, i);
    [token, next] = appendQuantifierSuffix(pattern, next, token);
    tokens.push(token);
    i = next;
  }
  return tokens;
}

/**
 * Split a pattern by | operator, respecting nested groups.
 * @param pattern The pattern string to split into alternatives.
 * @returns An array of alternative pattern strings extracted from the input pattern.
 */
export function splitAlternatives(pattern: string): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;
  
  for (const char of pattern) {
    if (char === '(') {
      depth++;
      current += char;
    } else if (char === ')') {
      depth--;
      current += char;
    } else if (char === '|' && depth === 0) {
      alternatives.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  alternatives.push(current);
  return alternatives;
}
