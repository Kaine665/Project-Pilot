/**
 * agent-event-builders 单元测试。
 * 运行: npx tsx src/lib/__tests__/agent-event-builders.test.ts
 */

import {
  buildError,
  buildTextDelta,
  buildThinkingDelta,
  buildTokenUsage,
  buildToolUseEnd,
  buildToolUseStart,
  formatCodexTodoSummaryLine,
  jsonBashCommand,
  jsonEditInputFromChanges,
  jsonTodoWriteFromCodexItems,
  jsonWebSearchQuery,
  mapCodexTodosToTodoWriteRows,
  stringifyToolInput,
} from '../agent-event-builders';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

// build* 形状
const td = buildTextDelta('hi');
assert(td.type === 'text_delta' && td.text === 'hi', 'buildTextDelta');

const th = buildThinkingDelta('think');
assert(th.type === 'thinking_delta' && th.text === 'think', 'buildThinkingDelta');

const ts = buildToolUseStart('id1', 'Read', '{}');
assert(ts.type === 'tool_use_start' && ts.id === 'id1' && ts.toolName === 'Read' && ts.input === '{}', 'buildToolUseStart');

const te = buildToolUseEnd('id1', 'out', 'failed');
assert(te.type === 'tool_use_end' && te.status === 'failed' && te.output === 'out', 'buildToolUseEnd');

const err = buildError('e');
assert(err.type === 'error' && err.message === 'e', 'buildError');

const tu = buildTokenUsage({ inputTokens: 1, outputTokens: 2 });
assert(
  tu.type === 'token_usage' && tu.inputTokens === 1 && tu.outputTokens === 2 && tu.final === undefined,
  'buildTokenUsage basic',
);

const tuf = buildTokenUsage({ inputTokens: 3, outputTokens: 4, contextWindow: 100, final: true });
assert(
  tuf.type === 'token_usage'
  && tuf.contextWindow === 100
  && tuf.final === true,
  'buildTokenUsage with optional',
);

// stringifyToolInput
assert(stringifyToolInput('raw') === 'raw', 'stringifyToolInput string');
assert(stringifyToolInput({ a: 1 }) === '{"a":1}', 'stringifyToolInput object');

// Codex JSON 规范化
assert(jsonBashCommand('ls -la') === '{"command":"ls -la"}', 'jsonBashCommand');
assert(jsonWebSearchQuery('q') === '{"query":"q"}', 'jsonWebSearchQuery');

const editJson = jsonEditInputFromChanges([{ path: '/a/b.ts', kind: 'update' }]);
assert(editJson.includes('file_path') && editJson.includes('/a/b.ts'), 'jsonEditInputFromChanges');

const rows = mapCodexTodosToTodoWriteRows([{ text: 't', completed: true }]);
assert(rows.length === 1 && rows[0].status === 'completed' && rows[0].content === 't', 'mapCodexTodosToTodoWriteRows');

const tw = jsonTodoWriteFromCodexItems([{ text: 'a', completed: false }]);
assert(tw.includes('"merge":true') && tw.includes('pending') && tw.includes('a'), 'jsonTodoWriteFromCodexItems');

assert(formatCodexTodoSummaryLine([]) === '', 'formatCodexTodoSummaryLine empty');
assert(formatCodexTodoSummaryLine([{ text: 'x', completed: true }]).includes('✓'), 'formatCodexTodoSummaryLine check');

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('  ALL TESTS PASSED\n');
