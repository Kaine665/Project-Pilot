#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const targets = [
  path.join(projectRoot, 'build'),
  path.join(projectRoot, '.next', 'standalone', 'build'),
];

for (const target of targets) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[clean-desktop-artifacts] Removed ${path.relative(projectRoot, target)}`);
  }
}
