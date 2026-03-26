'use client';

import {
  File, FileText, FileCode, FileJson, FileImage, FileVideo, FileAudio,
  FileArchive, FileSpreadsheet, Settings, Database, Package, Lock, Key,
  Globe, Palette, Terminal, BookOpen, Bug,
} from 'lucide-react';

const EXT_ICON_MAP: Record<string, { icon: typeof File; color: string }> = {
  // TypeScript / JavaScript
  ts:   { icon: FileCode, color: 'text-blue-500' },
  tsx:  { icon: FileCode, color: 'text-blue-400' },
  js:   { icon: FileCode, color: 'text-yellow-500' },
  jsx:  { icon: FileCode, color: 'text-yellow-400' },
  mjs:  { icon: FileCode, color: 'text-yellow-500' },
  cjs:  { icon: FileCode, color: 'text-yellow-500' },

  // Web
  html: { icon: Globe, color: 'text-orange-500' },
  htm:  { icon: Globe, color: 'text-orange-500' },
  css:  { icon: Palette, color: 'text-purple-500' },
  scss: { icon: Palette, color: 'text-pink-500' },
  less: { icon: Palette, color: 'text-indigo-400' },
  svg:  { icon: FileImage, color: 'text-amber-500' },

  // Data / Config
  json: { icon: FileJson, color: 'text-yellow-600' },
  yaml: { icon: Settings, color: 'text-red-400' },
  yml:  { icon: Settings, color: 'text-red-400' },
  toml: { icon: Settings, color: 'text-orange-400' },
  ini:  { icon: Settings, color: 'text-zinc-500' },
  env:  { icon: Key, color: 'text-green-600' },
  xml:  { icon: FileCode, color: 'text-orange-400' },

  // Docs
  md:       { icon: BookOpen, color: 'text-zinc-600 dark:text-zinc-400' },
  mdx:      { icon: BookOpen, color: 'text-zinc-600 dark:text-zinc-400' },
  txt:      { icon: FileText, color: 'text-zinc-500' },
  pdf:      { icon: FileText, color: 'text-red-500' },

  // Python
  py:   { icon: FileCode, color: 'text-green-500' },
  pyi:  { icon: FileCode, color: 'text-green-400' },
  ipynb: { icon: FileCode, color: 'text-orange-500' },

  // Rust / Go / Java / C
  rs:   { icon: FileCode, color: 'text-orange-600' },
  go:   { icon: FileCode, color: 'text-cyan-500' },
  java: { icon: FileCode, color: 'text-red-500' },
  kt:   { icon: FileCode, color: 'text-purple-500' },
  swift:{ icon: FileCode, color: 'text-orange-500' },
  c:    { icon: FileCode, color: 'text-blue-600' },
  cpp:  { icon: FileCode, color: 'text-blue-700' },
  h:    { icon: FileCode, color: 'text-blue-500' },
  hpp:  { icon: FileCode, color: 'text-blue-600' },

  // Shell / Scripts
  sh:   { icon: Terminal, color: 'text-green-600' },
  bash: { icon: Terminal, color: 'text-green-600' },
  zsh:  { icon: Terminal, color: 'text-green-600' },
  ps1:  { icon: Terminal, color: 'text-blue-500' },
  bat:  { icon: Terminal, color: 'text-zinc-500' },
  cmd:  { icon: Terminal, color: 'text-zinc-500' },

  // DB
  sql:  { icon: Database, color: 'text-blue-500' },
  db:   { icon: Database, color: 'text-zinc-500' },
  sqlite: { icon: Database, color: 'text-blue-400' },

  // Images
  png:  { icon: FileImage, color: 'text-green-500' },
  jpg:  { icon: FileImage, color: 'text-green-500' },
  jpeg: { icon: FileImage, color: 'text-green-500' },
  gif:  { icon: FileImage, color: 'text-green-500' },
  webp: { icon: FileImage, color: 'text-green-500' },
  ico:  { icon: FileImage, color: 'text-green-500' },
  bmp:  { icon: FileImage, color: 'text-green-500' },

  // Video / Audio
  mp4:  { icon: FileVideo, color: 'text-purple-500' },
  webm: { icon: FileVideo, color: 'text-purple-500' },
  avi:  { icon: FileVideo, color: 'text-purple-500' },
  mov:  { icon: FileVideo, color: 'text-purple-500' },
  mp3:  { icon: FileAudio, color: 'text-pink-500' },
  wav:  { icon: FileAudio, color: 'text-pink-500' },
  ogg:  { icon: FileAudio, color: 'text-pink-500' },

  // Archives
  zip:  { icon: FileArchive, color: 'text-amber-600' },
  tar:  { icon: FileArchive, color: 'text-amber-600' },
  gz:   { icon: FileArchive, color: 'text-amber-600' },
  '7z': { icon: FileArchive, color: 'text-amber-600' },
  rar:  { icon: FileArchive, color: 'text-amber-600' },

  // Package
  lock: { icon: Lock, color: 'text-zinc-400' },
  csv:  { icon: FileSpreadsheet, color: 'text-green-600' },
  log:  { icon: Bug, color: 'text-zinc-400' },
};

const FILENAME_MAP: Record<string, { icon: typeof File; color: string }> = {
  'package.json':     { icon: Package, color: 'text-green-600' },
  'package-lock.json':{ icon: Lock, color: 'text-zinc-400' },
  'yarn.lock':        { icon: Lock, color: 'text-zinc-400' },
  'pnpm-lock.yaml':   { icon: Lock, color: 'text-zinc-400' },
  'tsconfig.json':    { icon: Settings, color: 'text-blue-500' },
  'tailwind.config.ts': { icon: Palette, color: 'text-cyan-500' },
  'tailwind.config.js': { icon: Palette, color: 'text-cyan-500' },
  '.gitignore':       { icon: Settings, color: 'text-orange-400' },
  '.eslintrc.json':   { icon: Settings, color: 'text-purple-500' },
  'Dockerfile':       { icon: Package, color: 'text-blue-500' },
  'docker-compose.yml': { icon: Package, color: 'text-blue-500' },
  'Makefile':         { icon: Terminal, color: 'text-zinc-600' },
  'Cargo.toml':       { icon: Package, color: 'text-orange-600' },
  '.env':             { icon: Key, color: 'text-green-600' },
  '.env.local':       { icon: Key, color: 'text-green-600' },
  '.env.development': { icon: Key, color: 'text-green-600' },
  '.env.production':  { icon: Key, color: 'text-green-600' },
};

export function getFileIconInfo(filename: string): { icon: typeof File; color: string } {
  // Check full filename first
  const byName = FILENAME_MAP[filename];
  if (byName) return byName;

  // Check extension
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : '';
  const byExt = EXT_ICON_MAP[ext];
  if (byExt) return byExt;

  return { icon: File, color: 'text-zinc-400 dark:text-zinc-500' };
}

export function FileTypeIcon({ filename, className }: { filename: string; className?: string }) {
  const { icon: Icon, color } = getFileIconInfo(filename);
  return <Icon className={`${className ?? 'h-4 w-4'} shrink-0 ${color}`} />;
}
