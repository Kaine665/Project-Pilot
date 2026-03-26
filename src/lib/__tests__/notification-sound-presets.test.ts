/**
 * 通知声音配置测试
 * 运行方式: npx tsx src/lib/__tests__/notification-sound-presets.test.ts
 */

import { BUILT_IN_NOTIFICATION_TONES, normalizeNotificationSettings } from '../notification/notification-sound-presets';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

const normalizedBuiltin = normalizeNotificationSettings({
  soundSource: 'builtin',
  builtinSound: 'glass',
  soundEnabled: true,
});
assert(normalizedBuiltin.soundSource === 'builtin', 'builtin source preserved');
assert(normalizedBuiltin.builtinSound === 'glass', 'builtin preset preserved');

const normalizedCustom = normalizeNotificationSettings({
  soundSource: 'custom',
  customSoundDataUrl: 'data:audio/mpeg;base64,Zm9v',
  customSoundName: 'notify.mp3',
});
assert(normalizedCustom.soundSource === 'custom', 'custom source preserved');
assert(normalizedCustom.customSoundDataUrl === 'data:audio/mpeg;base64,Zm9v', 'custom data url preserved');
assert(normalizedCustom.customSoundName === 'notify.mp3', 'custom sound name preserved');

const normalizedInvalid = normalizeNotificationSettings({
  soundSource: 'weird' as never,
  builtinSound: 'unknown' as never,
  customSoundDataUrl: 'https://example.com/not-a-data-url.mp3',
  customSoundName: '',
});
assert(normalizedInvalid.soundSource === 'builtin', 'invalid source falls back to builtin');
assert(normalizedInvalid.builtinSound === 'classic', 'invalid preset falls back to classic');
assert(normalizedInvalid.customSoundDataUrl === undefined, 'invalid custom data url removed');
assert(normalizedInvalid.customSoundName === undefined, 'empty custom sound name removed');

for (const [id, sequence] of Object.entries(BUILT_IN_NOTIFICATION_TONES)) {
  assert(sequence.length > 0, `${id} has at least one tone step`);
  assert(sequence.every((step) => step.frequency > 0), `${id} frequencies are positive`);
  assert(sequence.every((step) => step.durationMs > 0), `${id} durations are positive`);
}

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('  ALL TESTS PASSED');
}

