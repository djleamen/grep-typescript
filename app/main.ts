/**
 * Grep - A simple grep implementation in TypeScript.
 * From CodeCrafters.io build-your-own-grep (TypeScript).
 */

const args = process.argv;
const pattern = args[3];

const inputLine: string = await Bun.stdin.text();

/**
 * Tokenize a pattern into individual components.
 */
function tokenizePattern(pattern: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  
  while (i < pattern.length) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) {
      tokens.push(pattern.slice(i, i + 2));
      i += 2;
    } else if (pattern[i] === '[') {
      const end = pattern.indexOf(']', i);
      if (end !== -1) {
        tokens.push(pattern.slice(i, end + 1));
        i = end + 1;
      } else {
        tokens.push(pattern[i]);
        i++;
      }
    } else {
      tokens.push(pattern[i]);
      i++;
    }
  }
  return tokens;
}

/**
 * Check if a single character matches a single token.
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
 */
function matchTokensAt(input: string, tokens: string[], startPos: number): boolean {
  let inputPos = startPos;
  
  for (const token of tokens) {
    if (inputPos >= input.length) {
      return false;
    }
    if (!matchToken(input[inputPos], token)) {
      return false;
    }
    inputPos++;
  }
  return true;
}

function matchPattern(inputLine: string, pattern: string): boolean {
  const tokens = tokenizePattern(pattern);
  
  for (let i = 0; i <= inputLine.length - tokens.length; i++) {
    if (matchTokensAt(inputLine, tokens, i)) {
      return true;
    }
  }
  return false;
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