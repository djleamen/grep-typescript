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
  if (token === String.raw`\d`) {
    return char >= '0' && char <= '9';
  } else if (token === String.raw`\w`) {
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
 * Captures and group-offset context passed through recursive matching calls.
 */
type MatchContext = { captures: (string | undefined)[]; groupOffset: number };

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
  return matchTokensLengthHelper(input, altTokens, 0, startPos, startPos, false, { captures, groupOffset });
}

/**
 * Shared parameters for recursive token-matching helpers, bundled to avoid wide function signatures.
 */
type MatchParams = {
  input: string;
  tokens: string[];
  tokenIdx: number;
  inputPos: number;
  startPos: number;
  mustEndAtInputEnd: boolean;
  captures: (string | undefined)[];
  groupOffset: number;
};

/**
 * Invoke the next-token continuation from within a token handler.
 * @param p The current match parameters.
 * @param nextTokenIdx The index of the next token to match.
 * @param nextInputPos The position in the input after consuming the current token.
 * @returns The number of characters consumed if the remaining tokens match, or -1 otherwise.
 */
function recurse(p: MatchParams, nextTokenIdx: number, nextInputPos: number): number {
  return matchTokensLengthHelper(
    p.input, p.tokens, nextTokenIdx, nextInputPos,
    p.startPos, p.mustEndAtInputEnd, { captures: p.captures, groupOffset: p.groupOffset },
  );
}

/**
 * Attempt to match a single capturing-group alternative using greedy backtracking.
 * Tries all possible end positions from longest to shortest, recording the capture on success.
 * @param p The current match parameters.
 * @param altTokens Tokens for the alternative branch to attempt.
 * @param groupNum The 1-based capturing group number for this match.
 * @param capturesBefore Snapshot of captures before this attempt, used to restore on failure.
 * @returns The total characters consumed from startPos if the full match succeeds, or -1 otherwise.
 */
function tryMatchCapturingAlternative(
  p: MatchParams, altTokens: string[], groupNum: number, capturesBefore: (string | undefined)[],
): number {
  for (let endPos = p.input.length; endPos >= p.inputPos; endPos--) {
    p.captures.splice(0, p.captures.length, ...capturesBefore);
    const innerResult = matchTokensLengthHelper(
      p.input.slice(0, endPos), altTokens, 0, p.inputPos, p.inputPos, true,
      { captures: p.captures, groupOffset: groupNum },
    );
    if (innerResult !== -1) {
      p.captures[groupNum - 1] = p.input.slice(p.inputPos, endPos);
      const result = recurse(p, p.tokenIdx + 1, endPos);
      if (result !== -1) return result;
    }
  }
  return -1;
}

/**
 * Match a capturing group token against the input, trying each alternative in order.
 * Restores the captures array if no alternative succeeds.
 * @param p The current match parameters whose current token is a capturing group.
 * @returns The total characters consumed from startPos if any alternative matches, or -1 otherwise.
 */
function matchCapturingGroupToken(p: MatchParams): number {
  const token = p.tokens[p.tokenIdx];
  const innerContent = token.slice(1, -1);
  const alternatives = splitAlternatives(innerContent);
  const precedingParens = p.tokens.slice(0, p.tokenIdx).reduce((sum, t) => sum + countOpenParens(t), 0);
  const groupNum = p.groupOffset + precedingParens + 1;
  const capturesBefore = p.captures.slice();

  for (const alternative of alternatives) {
    const altTokens = tokenizePattern(alternative);
    const result = tryMatchCapturingAlternative(p, altTokens, groupNum, capturesBefore);
    if (result !== -1) return result;
  }

  p.captures.splice(0, p.captures.length, ...capturesBefore);
  return -1;
}

/**
 * Match a group with a `+` quantifier (one or more repetitions) using greedy backtracking.
 * @param p The current match parameters.
 * @param innerContent The content inside the group parentheses.
 * @returns The total characters consumed from startPos if at least one repetition matches, or -1 otherwise.
 */
function matchGroupPlusQuantifier(p: MatchParams, innerContent: string): number {
  const positions: number[] = [];
  let pos = p.inputPos;
  while (true) {
    const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
    if (consumed <= 0) break;
    pos += consumed;
    positions.push(pos);
  }
  if (positions.length === 0) return -1;
  for (let i = positions.length - 1; i >= 0; i--) {
    const result = recurse(p, p.tokenIdx + 1, positions[i]);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a group with a `*` quantifier (zero or more repetitions) using greedy backtracking.
 * @param p The current match parameters.
 * @param innerContent The content inside the group parentheses.
 * @returns The total characters consumed from startPos, or -1 if no continuation matches.
 */
function matchGroupStarQuantifier(p: MatchParams, innerContent: string): number {
  const positions: number[] = [p.inputPos];
  let pos = p.inputPos;
  while (true) {
    const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
    if (consumed <= 0) break;
    pos += consumed;
    positions.push(pos);
  }
  for (let i = positions.length - 1; i >= 0; i--) {
    const result = recurse(p, p.tokenIdx + 1, positions[i]);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a group with a `?` quantifier (zero or one repetition), preferring one match first.
 * @param p The current match parameters.
 * @param innerContent The content inside the group parentheses.
 * @returns The total characters consumed from startPos, or -1 if neither branch matches.
 */
function matchGroupOptionalQuantifier(p: MatchParams, innerContent: string): number {
  const consumed = tryMatchGroupAtPos(p.input, innerContent, p.inputPos);
  if (consumed > 0) {
    const result = recurse(p, p.tokenIdx + 1, p.inputPos + consumed);
    if (result !== -1) return result;
  }
  return recurse(p, p.tokenIdx + 1, p.inputPos);
}

/**
 * Dispatch to the appropriate group quantifier handler based on the trailing quantifier character.
 * @param p The current match parameters whose current token is a group followed by `*`, `+`, or `?`.
 * @returns The total characters consumed from startPos, or -1 if no match.
 */
function matchGroupWithQuantifierToken(p: MatchParams): number {
  const token = p.tokens[p.tokenIdx];
  const quantifier = token.at(-1)!;
  const innerContent = token.slice(1, -2);
  if (quantifier === '+') return matchGroupPlusQuantifier(p, innerContent);
  if (quantifier === '*') return matchGroupStarQuantifier(p, innerContent);
  return matchGroupOptionalQuantifier(p, innerContent);
}

/**
 * Match a token with an exact `{n}` quantifier, consuming exactly n repetitions.
 * Handles both group tokens and single-character tokens.
 * @param p The current match parameters.
 * @param base The base token (character or group) to repeat.
 * @param n The exact number of repetitions required.
 * @returns The total characters consumed from startPos if exactly n repetitions match, or -1 otherwise.
 */
function matchExactQuantifierToken(p: MatchParams, base: string, n: number): number {
  if (base.startsWith('(') && base.endsWith(')')) {
    const innerContent = base.slice(1, -1);
    let pos = p.inputPos;
    for (let k = 0; k < n; k++) {
      const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
      if (consumed === -1) return -1;
      pos += consumed;
    }
    return recurse(p, p.tokenIdx + 1, pos);
  }
  let pos = p.inputPos;
  for (let k = 0; k < n; k++) {
    if (pos >= p.input.length || !matchToken(p.input[pos], base)) return -1;
    pos++;
  }
  return recurse(p, p.tokenIdx + 1, pos);
}

/**
 * Match a group with an `{n,}` quantifier (at least n repetitions) using greedy backtracking.
 * @param p The current match parameters.
 * @param innerContent The content inside the group parentheses.
 * @param n The minimum number of repetitions required.
 * @returns The total characters consumed from startPos, or -1 if fewer than n repetitions match.
 */
function matchAtLeastGroupQuantifier(p: MatchParams, innerContent: string, n: number): number {
  let pos = p.inputPos;
  for (let k = 0; k < n; k++) {
    const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
    if (consumed === -1) return -1;
    pos += consumed;
  }
  const positions: number[] = [pos];
  while (true) {
    const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
    if (consumed <= 0) break;
    pos += consumed;
    positions.push(pos);
  }
  for (let i = positions.length - 1; i >= 0; i--) {
    const result = recurse(p, p.tokenIdx + 1, positions[i]);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a token with an `{n,}` quantifier (at least n repetitions) using greedy backtracking.
 * Handles both group tokens and single-character tokens.
 * @param p The current match parameters.
 * @param base The base token to repeat.
 * @param n The minimum number of repetitions required.
 * @returns The total characters consumed from startPos, or -1 if fewer than n repetitions match.
 */
function matchAtLeastQuantifierToken(p: MatchParams, base: string, n: number): number {
  if (base.startsWith('(') && base.endsWith(')')) {
    return matchAtLeastGroupQuantifier(p, base.slice(1, -1), n);
  }
  let pos = p.inputPos;
  for (let k = 0; k < n; k++) {
    if (pos >= p.input.length || !matchToken(p.input[pos], base)) return -1;
    pos++;
  }
  while (pos < p.input.length && matchToken(p.input[pos], base)) pos++;
  for (let end = pos; end >= p.inputPos + n; end--) {
    const result = recurse(p, p.tokenIdx + 1, end);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a group with an `{n,m}` quantifier (between n and m repetitions) using greedy backtracking.
 * @param p The current match parameters.
 * @param innerContent The content inside the group parentheses.
 * @param n The minimum number of repetitions.
 * @param m The maximum number of repetitions.
 * @returns The total characters consumed from startPos, or -1 if fewer than n repetitions match.
 */
function matchRangeGroupQuantifier(p: MatchParams, innerContent: string, n: number, m: number): number {
  let pos = p.inputPos;
  for (let k = 0; k < n; k++) {
    const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
    if (consumed === -1) return -1;
    pos += consumed;
  }
  const positions: number[] = [pos];
  for (let k = n; k < m; k++) {
    const consumed = tryMatchGroupAtPos(p.input, innerContent, pos);
    if (consumed <= 0) break;
    pos += consumed;
    positions.push(pos);
  }
  for (let i = positions.length - 1; i >= 0; i--) {
    const result = recurse(p, p.tokenIdx + 1, positions[i]);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a token with an `{n,m}` quantifier (between n and m repetitions) using greedy backtracking.
 * Handles both group tokens and single-character tokens.
 * @param p The current match parameters.
 * @param base The base token to repeat.
 * @param n The minimum number of repetitions.
 * @param m The maximum number of repetitions.
 * @returns The total characters consumed from startPos, or -1 if fewer than n repetitions match.
 */
function matchRangeQuantifierToken(p: MatchParams, base: string, n: number, m: number): number {
  if (base.startsWith('(') && base.endsWith(')')) {
    return matchRangeGroupQuantifier(p, base.slice(1, -1), n, m);
  }
  let pos = p.inputPos;
  for (let k = 0; k < n; k++) {
    if (pos >= p.input.length || !matchToken(p.input[pos], base)) return -1;
    pos++;
  }
  let maxPos = pos;
  for (let k = n; k < m && maxPos < p.input.length && matchToken(p.input[maxPos], base); k++) {
    maxPos++;
  }
  for (let end = maxPos; end >= pos; end--) {
    const result = recurse(p, p.tokenIdx + 1, end);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a simple (non-group) token with a `+` quantifier (one or more) using greedy backtracking.
 * @param p The current match parameters whose current token ends with `+`.
 * @returns The total characters consumed from startPos, or -1 if no match.
 */
function matchPlusToken(p: MatchParams): number {
  const baseToken = p.tokens[p.tokenIdx].slice(0, -1);
  let matchCount = 0;
  while (p.inputPos + matchCount < p.input.length && matchToken(p.input[p.inputPos + matchCount], baseToken)) {
    matchCount++;
  }
  if (matchCount === 0) return -1;
  for (let count = matchCount; count >= 1; count--) {
    const result = recurse(p, p.tokenIdx + 1, p.inputPos + count);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a simple (non-group) token with a `*` quantifier (zero or more) using greedy backtracking.
 * @param p The current match parameters whose current token ends with `*`.
 * @returns The total characters consumed from startPos, or -1 if no continuation matches.
 */
function matchStarToken(p: MatchParams): number {
  const baseToken = p.tokens[p.tokenIdx].slice(0, -1);
  let matchCount = 0;
  while (p.inputPos + matchCount < p.input.length && matchToken(p.input[p.inputPos + matchCount], baseToken)) {
    matchCount++;
  }
  for (let count = matchCount; count >= 0; count--) {
    const result = recurse(p, p.tokenIdx + 1, p.inputPos + count);
    if (result !== -1) return result;
  }
  return -1;
}

/**
 * Match a simple (non-group) token with a `?` quantifier (zero or one), preferring one match first.
 * @param p The current match parameters whose current token ends with `?`.
 * @returns The total characters consumed from startPos, or -1 if neither branch matches.
 */
function matchOptionalToken(p: MatchParams): number {
  const baseToken = p.tokens[p.tokenIdx].slice(0, -1);
  if (p.inputPos < p.input.length && matchToken(p.input[p.inputPos], baseToken)) {
    const result = recurse(p, p.tokenIdx + 1, p.inputPos + 1);
    if (result !== -1) return result;
  }
  return recurse(p, p.tokenIdx + 1, p.inputPos);
}

/**
 * Match a backreference (`\1`–`\9`) or a literal character token at the current input position.
 * @param p The current match parameters.
 * @returns The total characters consumed from startPos, or -1 if no match.
 */
function matchBackrefOrLiteral(p: MatchParams): number {
  const token = p.tokens[p.tokenIdx];
  if (token.length === 2 && token.startsWith('\\') && token[1] >= '1' && token[1] <= '9') {
    const groupNum = Number.parseInt(token[1], 10);
    const capturedText = p.captures[groupNum - 1];
    if (capturedText === undefined) return -1;
    if (p.input.slice(p.inputPos, p.inputPos + capturedText.length) !== capturedText) return -1;
    return recurse(p, p.tokenIdx + 1, p.inputPos + capturedText.length);
  }
  if (p.inputPos >= p.input.length) return -1;
  if (!matchToken(p.input[p.inputPos], token)) return -1;
  return recurse(p, p.tokenIdx + 1, p.inputPos + 1);
}

/**
 * Return true if the token represents a complete capturing group (e.g. `(abc)`).
 * @param token The token string to test.
 * @returns True if the token starts with `(` and ends with `)`.
 */
function isCapturingGroup(token: string): boolean {
  return token.startsWith('(') && token.endsWith(')');
}

/**
 * Return true if the token is a group immediately followed by a `*`, `+`, or `?` quantifier.
 * @param token The token string to test.
 * @returns True if the token starts with `(` and ends with `*`, `+`, or `?`.
 */
function isGroupWithQuantifier(token: string): boolean {
  return token.startsWith('(') && ['*', '+', '?'].includes(token.at(-1)!);
}

/**
 * Core recursive token matcher. Attempts to match tokens[tokenIdx..] against input starting at inputPos.
 * @param input The input string to match against.
 * @param tokens The tokenized pattern array.
 * @param tokenIdx The index of the current token to match.
 * @param inputPos The current position in the input string.
 * @param startPos The position where this match attempt began (used to compute consumed length).
 * @param mustEndAtInputEnd Whether the match must consume the entire remaining input.
 * @param ctx Optional captures and group-offset context; defaults to empty captures and zero offset.
 * @returns The number of characters consumed from startPos if all tokens match, or -1 on failure.
 */
export function matchTokensLengthHelper(
  input: string,
  tokens: string[],
  tokenIdx: number,
  inputPos: number,
  startPos: number,
  mustEndAtInputEnd: boolean,
  ctx?: MatchContext,
): number {
  ctx ??= { captures: [], groupOffset: 0 };
  const { captures, groupOffset } = ctx;
  if (tokenIdx >= tokens.length) {
    if (mustEndAtInputEnd && inputPos !== input.length) return -1;
    return inputPos - startPos;
  }

  const token = tokens[tokenIdx];
  const p: MatchParams = { input, tokens, tokenIdx, inputPos, startPos, mustEndAtInputEnd, captures, groupOffset };


  if (isCapturingGroup(token)) return matchCapturingGroupToken(p);
  if (isGroupWithQuantifier(token)) return matchGroupWithQuantifierToken(p);

  const exactQLH = parseExactQuantifier(token);
  if (exactQLH !== null) return matchExactQuantifierToken(p, exactQLH.base, exactQLH.n);

  const atLeastQLH = parseAtLeastQuantifier(token);
  if (atLeastQLH !== null) return matchAtLeastQuantifierToken(p, atLeastQLH.base, atLeastQLH.n);

  const rangeQLH = parseRangeQuantifier(token);
  if (rangeQLH !== null) return matchRangeQuantifierToken(p, rangeQLH.base, rangeQLH.n, rangeQLH.m);

  if (token.endsWith('+')) return matchPlusToken(p);
  if (token.endsWith('*')) return matchStarToken(p);
  if (token.endsWith('?')) return matchOptionalToken(p);

  return matchBackrefOrLiteral(p);
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
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, false) !== -1;
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
  return matchTokensLengthHelper(input, tokens, 0, startPos, startPos, true) !== -1;
}

/**
 * Scan the entire input line for a match using the given per-position match function.
 * @param inputLine The line of input to scan.
 * @param tokens The tokenized pattern to match against.
 * @param matchFn A predicate that returns true if the tokens match at a given position.
 * @returns True if any position in the line satisfies matchFn, false otherwise.
 */
function scanForMatch(
  inputLine: string, tokens: string[], matchFn: (input: string, tokens: string[], pos: number) => boolean,
): boolean {
  for (let i = 0; i < inputLine.length; i++) {
    if (matchFn(inputLine, tokens, i)) return true;
  }
  return false;
}

/**
 * Match an entire input line against a pattern string, respecting `^` and `$` anchors.
 * @param inputLine The line of input to test.
 * @param pattern The pattern string, optionally prefixed with `^` or suffixed with `$`.
 * @returns True if the pattern matches anywhere in the input line (or fully, if anchored).
 */
export function matchPattern(inputLine: string, pattern: string): boolean {
  const hasStartAnchor = pattern.startsWith('^');
  const hasEndAnchor = pattern.endsWith('$');
  const cleanPattern = pattern.slice(hasStartAnchor ? 1 : 0, hasEndAnchor ? -1 : undefined);
  const tokens = tokenizePattern(cleanPattern);

  if (hasStartAnchor && hasEndAnchor) return matchTokensAtEnd(inputLine, tokens, 0);
  if (hasStartAnchor) return matchTokensAt(inputLine, tokens, 0);
  if (hasEndAnchor) return scanForMatch(inputLine, tokens, matchTokensAtEnd);
  return scanForMatch(inputLine, tokens, matchTokensAt);
}
