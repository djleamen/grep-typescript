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
    } else {
      token = pattern[i];
      i++;
    }

    if (i < pattern.length && pattern[i] === '+') {
      token += '+';
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
  let inputPos = startPos;
  
  for (let tokenIdx = 0; tokenIdx < tokens.length; tokenIdx++) {
    const token = tokens[tokenIdx];
    
    if (token.endsWith('+')) {
      const baseToken = token.slice(0, -1);
      let matchCount = 0;
      
      while (inputPos < input.length && matchToken(input[inputPos], baseToken)) {
        matchCount++;
        inputPos++;
      }
      
      if (matchCount === 0) {
        return false;
      }
    } else {
      if (inputPos >= input.length) {
        return false;
      }
      if (!matchToken(input[inputPos], token)) {
        return false;
      }
      inputPos++;
    }
  }
  return true;
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
    return tokens.length === inputLine.length && matchTokensAt(inputLine, tokens, 0);
  } else if (hasStartAnchor) {
    return matchTokensAt(inputLine, tokens, 0);
  } else if (hasEndAnchor) {
    const startPos = inputLine.length - tokens.length;
    return startPos >= 0 && matchTokensAt(inputLine, tokens, startPos);
  } else {
    for (let i = 0; i <= inputLine.length - tokens.length; i++) {
      if (matchTokensAt(inputLine, tokens, i)) {
        return true;
      }
    }
    return false;
  }
}

if (args[2] !== "-E") {
  console.log("Expected first argument to be '-E'");
  process.exit(1);
}

if (matchPattern(inputLine, pattern)) {
  process.exit(0);
} else {
  process.exit(1);
}