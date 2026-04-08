import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSkillFrontmatter, stripSkillFrontmatter } from './skill-store';

test('parseSkillFrontmatter reads inline YAML fields', () => {
  const meta = parseSkillFrontmatter(`---
name: sample-skill
description: Short description
---

Body`);

  assert.deepEqual(meta, {
    name: 'sample-skill',
    description: 'Short description',
  });
});

test('parseSkillFrontmatter reads literal block descriptions', () => {
  const meta = parseSkillFrontmatter(`---
name: sample-skill
description: |
  First line.
  Second line.

  Third paragraph.
---

Body`);

  assert.deepEqual(meta, {
    name: 'sample-skill',
    description: 'First line.\nSecond line.\n\nThird paragraph.',
  });
});

test('parseSkillFrontmatter reads folded block descriptions', () => {
  const meta = parseSkillFrontmatter(`---
name: sample-skill
description: >
  First line.
  Second line.

  Third paragraph.
---

Body`);

  assert.deepEqual(meta, {
    name: 'sample-skill',
    description: 'First line. Second line.\nThird paragraph.',
  });
});

test('parseSkillFrontmatter ignores nested metadata and still reads standard YAML', () => {
  const meta = parseSkillFrontmatter(`---
name: sample-skill
description: |
  First line.
  Second line.
metadata:
  author: Open Source
  tags:
    - browser
    - qa
---

Body`);

  assert.deepEqual(meta, {
    name: 'sample-skill',
    description: 'First line.\nSecond line.',
  });
});

test('parseSkillFrontmatter reads disable-model-invocation', () => {
  const meta = parseSkillFrontmatter(`---
name: gated
description: Hidden from model
disable-model-invocation: true
---

Never show this body in prompt.`);

  assert.deepEqual(meta, {
    name: 'gated',
    description: 'Hidden from model',
    disableModelInvocation: true,
  });
});

test('stripSkillFrontmatter returns body after closing ---', () => {
  const body = stripSkillFrontmatter(`---
name: x
description: y
---

## Instructions

Do the thing.
`);
  assert.equal(body, '## Instructions\n\nDo the thing.');
});
