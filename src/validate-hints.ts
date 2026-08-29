#!/usr/bin/env node
/**
 * Validates that every registerTool call in main.ts declares all four
 * MCP hint properties (readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint) with explicit boolean values.
 *
 * Exit code 0 = all tools are compliant.
 * Exit code 1 = one or more tools are missing hints.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');

const REQUIRED_HINTS = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
] as const;

// Extract each registerTool block.  We split on the keyword and re-attach
// it so we can check each call individually.
const parts = source.split(/(?=registerTool\()/);
const toolBlocks = parts.filter((p) => p.trimStart().startsWith('registerTool('));

let failures = 0;

for (const block of toolBlocks) {
  // Extract the tool name from the first string argument
  const nameMatch = block.match(/registerTool\(\s*['"]([^'"]+)['"]/);
  const name = nameMatch ? nameMatch[1] : '<unknown>';

  // Find which hint constant is used in this block
  const hintConstantMatch = block.match(/\b(\w+_HINTS)\b/);
  if (!hintConstantMatch) {
    console.error(`FAIL [${name}]: no hint constant found`);
    failures++;
    continue;
  }
  const hintConstant = hintConstantMatch[1];

  // Resolve the hint constant's value from the source
  const constPattern = new RegExp(
    `const ${hintConstant}[^=]*=\\s*\\{([^}]+)\\}`,
    's',
  );
  const constMatch = source.match(constPattern);
  if (!constMatch) {
    console.error(`FAIL [${name}]: hint constant "${hintConstant}" not found in source`);
    failures++;
    continue;
  }
  const constBody = constMatch[1];

  for (const hint of REQUIRED_HINTS) {
    // Check the hint exists in the constant body
    const hintPattern = new RegExp(`\\b${hint}\\s*:\\s*(true|false)\\b`);
    if (!hintPattern.test(constBody)) {
      console.error(
        `FAIL [${name}]: "${hint}" is missing or not a boolean in constant "${hintConstant}"`,
      );
      failures++;
    }
  }
}

if (failures === 0) {
  console.log(
    `OK: all ${toolBlocks.length} tool(s) declare all four MCP hints with boolean values.`,
  );
  process.exit(0);
} else {
  console.error(`\n${failures} hint violation(s) found.`);
  process.exit(1);
}
