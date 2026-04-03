#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, '.next', 'standalone');
const hashedNodeModulesRoot = path.join(standaloneRoot, '.next', 'node_modules');
const runtimeNodeModulesRoot = path.join(standaloneRoot, 'node_modules');
const bundledRuntimeNodeModulesRoot = path.join(standaloneRoot, 'pp_node_modules');

function materializeSymlink(linkPath) {
  const stat = fs.lstatSync(linkPath);
  if (!stat.isSymbolicLink()) return false;

  const linkTarget = fs.readlinkSync(linkPath);
  const resolvedTarget = path.resolve(path.dirname(linkPath), linkTarget);
  if (!fs.existsSync(resolvedTarget)) {
    throw new Error(`Symlink target does not exist: ${linkPath} -> ${linkTarget}`);
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  const targetStat = fs.statSync(resolvedTarget);
  if (targetStat.isDirectory()) {
    fs.cpSync(resolvedTarget, linkPath, { recursive: true, dereference: true });
  } else {
    fs.copyFileSync(resolvedTarget, linkPath);
  }
  return true;
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    results.push(fullPath);
    if (entry.isDirectory()) {
      walk(fullPath, results);
    }
  }
  return results;
}

const nestedBuildDir = path.join(standaloneRoot, 'build');
if (fs.existsSync(nestedBuildDir)) {
  fs.rmSync(nestedBuildDir, { recursive: true, force: true });
  console.log('[prepare-desktop-bundle] Removed stale standalone/build directory');
}

if (fs.existsSync(bundledRuntimeNodeModulesRoot)) {
  fs.rmSync(bundledRuntimeNodeModulesRoot, { recursive: true, force: true });
}
if (fs.existsSync(runtimeNodeModulesRoot)) {
  fs.cpSync(runtimeNodeModulesRoot, bundledRuntimeNodeModulesRoot, { recursive: true, dereference: true });
  console.log('[prepare-desktop-bundle] Copied standalone/node_modules -> standalone/pp_node_modules');
}

if (!fs.existsSync(hashedNodeModulesRoot)) {
  console.log('[prepare-desktop-bundle] No hashed standalone node_modules found; skipping');
  process.exit(0);
}

let changed = 0;
for (const fullPath of walk(hashedNodeModulesRoot)) {
  try {
    if (materializeSymlink(fullPath)) {
      changed += 1;
      console.log(`[prepare-desktop-bundle] Materialized symlink: ${path.relative(projectRoot, fullPath)}`);
    }
  } catch (error) {
    console.error(`[prepare-desktop-bundle] Failed on ${fullPath}`);
    throw error;
  }
}

console.log(`[prepare-desktop-bundle] Done. Materialized ${changed} symlink(s).`);
