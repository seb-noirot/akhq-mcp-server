import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { toolContracts } from './main.js';

function getTool(name: string) {
  const tool = toolContracts.find((entry) => entry.name === name);
  assert.ok(tool, `expected tool "${name}" to be registered`);
  return tool;
}

test('all tools expose schema and MCP hints', () => {
  assert.ok(toolContracts.length > 0, 'expected at least one registered tool');

  for (const tool of toolContracts) {
    assert.ok(tool.parameters && typeof tool.parameters === 'object', `${tool.name} must declare an input schema`);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean', `${tool.name} must declare readOnlyHint`);
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean', `${tool.name} must declare destructiveHint`);
    assert.equal(typeof tool.annotations.idempotentHint, 'boolean', `${tool.name} must declare idempotentHint`);
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} must declare openWorldHint`);
  }
});

test('successful invocation smoke test: list_environments', async () => {
  const tool = getTool('list_environments');
  const result = await tool.invoke({});
  const payload = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(payload));
  assert.ok(payload.length > 0);
  assert.equal(typeof payload[0].name, 'string');
  assert.equal(typeof payload[0].baseUrl, 'string');
});

test('input validation contract: set_environment rejects missing name', () => {
  const tool = getTool('set_environment');
  const parsed = z.object(tool.parameters).safeParse({});
  assert.equal(parsed.success, false);
});
