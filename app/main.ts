/**
 * Grep - A simple grep implementation in TypeScript.
 * From CodeCrafters.io build-your-own-grep (TypeScript).
 */

const args = process.argv;
const pattern = args[3];

const inputLine: string = await Bun.stdin.text();

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

    if (i < pattern.length && (pattern[i] === '+' || pattern[i] === '?')) {
      token += pattern[i];
      i++;
    }
    tokens.push(token);
  }
  return tokens;
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
  return matchTokensHelper(input, tokens, 0, startPos);
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
 */
function matchAlternative(input: string, altTokens: string[], startPos: number): number {
  return matchAlternativeHelper(input, altTokens, 0, startPos, startPos);
}

/**
 * Helper to match an alternative and track chars consumed.
 */
function matchAlternativeHelper(input: string, tokens: string[], tokenIdx: number, startPos: number, inputPos: number): number {
  if (tokenIdx >= tokens.length) {
    return inputPos - startPos;
  }
  
  const token = tokens[tokenIdx];
  
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
 * Check if tokens match starting from startPos and end exactly at the end of input.
 * @param input The input string to match against.
 * @param tokens The array of tokens to match.
 * @param startPos The starting position in the input string.
 * @returns True if the tokens match and end at the end of the input, false otherwise.
 */
function matchTokensAtEnd(input: string, tokens: string[], startPos: number): boolean {
  return matchTokensHelperEnd(input, tokens, 0, startPos);
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

if (args[2] !== "-E") {
  console.log("Expected first argument to be '-E'");
  process.exit(1);
}

const lines = inputLine.split("\n");
// Remove trailing empty string caused by a trailing newline
if (lines.length > 0 && lines[lines.length - 1] === "") {
  lines.pop();
}

let anyMatch = false;
for (const line of lines) {
  if (matchPattern(line, pattern)) {
    process.stdout.write(line + "\n");
    anyMatch = true;
  }
}

process.exit(anyMatch ? 0 : 1);