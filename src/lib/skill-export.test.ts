import test from 'node:test';
import assert from 'node:assert/strict';

import { exportSkill } from './skill-export';

test('standard export preserves public SKILL.md exactly', () => {
  const content = `---
name: gstack
description: |
  Fast browser QA.
  With evidence.
metadata:
  author: OSS
---

Body`;

  const exported = exportSkill({
    name: 'gstack',
    content,
  }, 'standard');

  assert.equal(exported.fileName, 'SKILL.md');
  assert.equal(exported.content, content);
});

test('legacy aliases still export the public SKILL.md exactly', () => {
  const content = `---
name: gstack
description: >
  Fast browser QA
  with folded text.
---

Body`;

  const openclawExport = exportSkill({ name: 'gstack', content }, 'openclaw');
  const rawExport = exportSkill({ name: 'gstack', content }, 'raw');

  assert.equal(openclawExport.fileName, 'SKILL.md');
  assert.equal(openclawExport.content, content);
  assert.equal(rawExport.fileName, 'SKILL.md');
  assert.equal(rawExport.content, content);
});
