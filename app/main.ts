/**
 * Grep - A simple grep implementation in TypeScript.
 * From CodeCrafters.io build-your-own-grep (TypeScript).
 */

const args = process.argv;
const pattern = args[3];

const inputLine: string = await Bun.stdin.text();

function matchPattern(inputLine: string, pattern: string): boolean {
  if (pattern === "\\d") {
    for (const char of inputLine) {
      if (char >= '0' && char <= '9') {
        return true;
      }
    }
    return false;
  } else if (pattern === "\\w") {
    for (const char of inputLine) {
      if ((char >= 'a' && char <= 'z') ||
          (char >= 'A' && char <= 'Z') ||
          (char >= '0' && char <= '9') ||
          char === '_') {
        return true;
      }
    }
    return false;
  } else if (pattern.length === 1) {
    return inputLine.includes(pattern);
  } else {
    throw new Error(`Unhandled pattern: ${pattern}`);
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