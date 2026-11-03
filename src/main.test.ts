import assert from 'node:assert/strict';
import test from 'node:test';
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

test('input validation contract: set_environment rejects missing name', async () => {
  const tool = getTool('set_environment');
  const result = await tool.invoke({});
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.error, 'Validation error');
  assert.equal(Array.isArray(payload.details), true);
  assert.equal(payload.details[0]?.path[0], 'name');
});

test('set_base_url is URL-only and updates the single active environment', async () => {
  const getCurrentEnvironment = getTool('get_current_environment');
  const setBaseUrl = getTool('set_base_url');

  const before = JSON.parse((await getCurrentEnvironment.invoke({})).content[0].text);
  const originalBaseUrl = before.baseUrl;
  const updatedBaseUrl = 'http://127.0.0.1:18080';

  const updateResult = JSON.parse((await setBaseUrl.invoke({ url: updatedBaseUrl })).content[0].text);
  assert.equal(updateResult.success, true);
  assert.equal(updateResult.baseUrl, updatedBaseUrl);

  const after = JSON.parse((await getCurrentEnvironment.invoke({})).content[0].text);
  assert.equal(after.baseUrl, updatedBaseUrl);

  await setBaseUrl.invoke({ url: originalBaseUrl });
});
