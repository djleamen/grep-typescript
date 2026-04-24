/**
 * Pattern tokenizer — splits a regex-like pattern string into tokens.
 */

/**
 * Tokenize a pattern into individual components.
 * @param pattern The pattern to tokenize.
 * @returns An array of tokens extracted from the pattern.
 */
export function tokenizePattern(pattern: string): string[] {
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
 * Split a pattern by | operator, respecting nested groups.
 * @param pattern The pattern string to split into alternatives.
 * @returns An array of alternative pattern strings extracted from the input pattern.
 */
export function splitAlternatives(pattern: string): string[] {
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
