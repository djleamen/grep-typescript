/**
 * Core matching engine — token matching, recursive backtracking matcher, and pattern matching.
 */

import { tokenizePattern, splitAlternatives } from "./tokenizer.ts";
import { parseExactQuantifier, parseAtLeastQuantifier, parseRangeQuantifier } from "./quantifiers.ts";

/**
 * Check if a single character matches a single token.
 * Supports \d, \w, ., character classes, and literal characters.
 * @param char The character from the input string to match.
 * @param token The token string to match against, which can be a special token or a literal character.
 * @returns True if the character matches the token, false otherwise.
 */
export function matchToken(char: string, token: string): boolean {
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
 * Count the number of opening parentheses in a token string.
 * Used to compute the correct group number for nested capturing groups.
 * @param token The token string to analyze.
 * @returns The number of opening parentheses in the token.
 */
function countOpenParens(token: string): number {
  let count = 0;
  for (const ch of token) {
    if (ch === '(') count++;
  }
  return count;
}

/**
 * Try to match a group (with alternatives) at a given position.
 * Returns the number of characters consumed, or -1 if no match.
 * @param input The input string to match against.
 * @param innerContent The content inside the parentheses, which may contain alternatives separated by |.
 * @param inputPos The position in the input string to start matching from.
 * @returns The number of characters consumed if a match is found, or -1 if no match is found.
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
 * Check if an alternative matches starting at the given position.
 * Returns the number of characters consumed, or -1 if no match.
 * @param input The input string to match against.
 * @param altTokens The tokens representing the alternative pattern.
 * @param startPos The position in the input string to start matching from.
 * @param groupOffset The offset for capturing group numbers.
 * @param captures The array to store captured substrings.
 * @returns The number of characters consumed if a match is found, or -1 if no match is found.
 */
function matchAlternative(input: string, altTokens: string[], startPos: number, groupOffset: number = 0, captures: (string | undefined)[] = []): number {
  return matchTokensLengthHelper(input, altTokens, 0, startPos, startPos, false, captures, groupOffset);
}

/**
 * Helper function to recursively match tokens and return consumed length.
 * Returns the number of characters consumed if the tokens match, or -1 if they do not match.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param tokenIdx The current index in the tokens array.
 * @param inputPos The current position in the input string.
 * @param startPos The starting position of the match attempt (used for calculating consumed length).
 * @param mustEndAtInputEnd Whether the match must end at the end of the input string.
 * @param captures The array to store captured substrings, indexed by group number.
 * @param groupOffset The offset to apply to group numbers for captures within this context.
 * @returns The number of characters consumed if the tokens match, or -1 if they do not match.
 */
export function matchTokensLengthHelper(
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
        input, tokens, tokenIdx + 1, inputPos + count, startPos, mustEndAtInputEnd, captures, groupOffset,
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
        input, tokens, tokenIdx + 1, inputPos + count, startPos, mustEndAtInputEnd, captures, groupOffset,
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
        input, tokens, tokenIdx + 1, inputPos + 1, startPos, mustEndAtInputEnd, captures, groupOffset,
      );
      if (result !== -1) {
        return result;
      }
    }

    return matchTokensLengthHelper(
      input, tokens, tokenIdx + 1, inputPos, startPos, mustEndAtInputEnd, captures, groupOffset,
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
      input, tokens, tokenIdx + 1, inputPos + 1, startPos, mustEndAtInputEnd, captures, groupOffset,
    );
  }
}

/**
 * Try to match a sequence of tokens starting from a specific position in the input.
 * Returns true if matched, false otherwise.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The position in the input string to start matching from.
 * @returns True if the tokens match starting from the given position, false otherwise.
 */
export function matchTokensAt(input: string, tokens: string[], startPos: number): boolean {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, false, []) !== -1;
}

/**
 * Try to match a sequence of tokens starting from a specific position.
 * Returns number of consumed characters if matched, otherwise -1.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The position in the input string to start matching from.
 * @returns The number of characters consumed if the tokens match starting from the given position, or -1 if they do not match.
 */
export function matchTokensLengthAt(input: string, tokens: string[], startPos: number): number {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, false);
}

/**
 * Try to match a sequence of tokens starting from a specific position and ending at input end.
 * Returns number of consumed characters if matched and ended at input end, otherwise -1.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The position in the input string to start matching from.
 * @returns The number of characters consumed if the tokens match starting from the given position and end at the end of the input, or -1 if they do not match or do not end at input end.
 */
export function matchTokensLengthAtEnd(input: string, tokens: string[], startPos: number): number {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, true);
}

/**
 * Check if tokens match starting from startPos and end exactly at the end of input.
 * Returns true if matched, false otherwise.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The position in the input string to start matching from.
 * @returns True if the tokens match starting from the given position and end at the end of the input, false otherwise.
 */
export function matchTokensAtEnd(input: string, tokens: string[], startPos: number): boolean {
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, true, []) !== -1;
}

/**
 * Match the input line against the pattern, considering ^ and $ anchors.
 * Returns true if the pattern matches the input line, false otherwise.
 * @param inputLine The line of input to match.
 * @param pattern The pattern to match, which may include ^ and $ anchors.
 * @returns True if the pattern matches the input line, false otherwise.
 */
export function matchPattern(inputLine: string, pattern: string): boolean {
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
