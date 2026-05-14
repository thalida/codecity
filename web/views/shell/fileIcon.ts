// views/shell/fileIcon.ts — VSCode-style file/folder icons (Material
// Icon Theme, MIT). Returns an <img> element pointing at a CDN-hosted
// SVG; the browser caches per URL so a project with N files but only K
// unique extensions only triggers K icon fetches on first paint.
//
// Why not lucide masks: lucide icons render via CSS mask-image so they
// pick up currentColor. The Material file icons are full-color brand
// glyphs — the COLOR is the info — so we render them as plain <img>
// instead. Trade: no theme-tint, but every-file-recognizable from a
// glance is the whole point.

import { NodeKind } from '@/types';
import type { DirNode, FileNode } from '@/types';

// Pinned to a version so the CDN's `latest` rolling tag can't surprise
// us with a removed icon or renamed file. Bump deliberately when
// adopting new icons; otherwise treat it as a fixed dependency.
const ICON_VERSION = '5.30.0';
const ICON_CDN_BASE = `https://cdn.jsdelivr.net/npm/material-icon-theme@${ICON_VERSION}/icons/`;

// Map file extension → Material icon basename. Keep this dense for the
// extensions our scanner typically yields. Anything missing falls
// through to the generic `file` icon.
const EXT_ICON: Record<string, string> = {
  // TS/JS family
  '.ts': 'typescript',
  '.tsx': 'react_ts',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'react',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Web
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.css': 'css',
  '.scss': 'sass',
  '.sass': 'sass',
  '.less': 'less',
  '.styl': 'stylus',
  // Data / config
  '.json': 'json',
  '.json5': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'settings',
  '.ini': 'settings',
  '.conf': 'settings',
  '.env': 'tune',
  // Docs
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'mdx',
  '.txt': 'document',
  '.rst': 'document',
  '.pdf': 'pdf',
  // Languages
  '.py': 'python',
  '.pyi': 'python',
  '.pyx': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'h',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'hpp',
  '.cs': 'csharp',
  '.fs': 'fsharp',
  '.php': 'php',
  '.lua': 'lua',
  '.r': 'r',
  '.pl': 'perl',
  '.scala': 'scala',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.clj': 'clojure',
  '.hs': 'haskell',
  '.zig': 'zig',
  '.nim': 'nim',
  // Shells / build
  '.sh': 'console',
  '.bash': 'console',
  '.zsh': 'console',
  '.fish': 'console',
  '.ps1': 'powershell',
  '.bat': 'console',
  '.cmd': 'console',
  '.makefile': 'makefile',
  '.mk': 'makefile',
  // SQL / queries
  '.sql': 'database',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  // Image / media
  '.svg': 'svg',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.ico': 'image',
  '.avif': 'image',
  '.tiff': 'image',
  '.psd': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.m4v': 'video',
  '.ogv': 'video',
  '.mkv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
  '.m4a': 'audio',
  '.ogg': 'audio',
  // Fonts
  '.ttf': 'font',
  '.otf': 'font',
  '.woff': 'font',
  '.woff2': 'font',
  '.eot': 'font',
  // Archives
  '.zip': 'zip',
  '.tar': 'zip',
  '.gz': 'zip',
  '.tgz': 'zip',
  '.7z': 'zip',
  '.rar': 'zip',
  '.bz2': 'zip',
  // Other
  '.lock': 'lock',
  '.log': 'log',
  '.diff': 'diff',
  '.patch': 'diff',
};

// Map exact filename (lowercased) → Material icon basename. Beats the
// EXT_ICON map when both match, because filename hints carry richer
// semantics than the bare extension (package.json → npm, not json).
const NAME_ICON: Record<string, string> = {
  'package.json': 'nodejs',
  'package-lock.json': 'nodejs',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'tsconfig.json': 'tsconfig',
  'tsconfig.node.json': 'tsconfig',
  'tsconfig.app.json': 'tsconfig',
  'tsconfig.build.json': 'tsconfig',
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.gitkeep': 'git',
  '.npmignore': 'npm',
  '.npmrc': 'npm',
  '.editorconfig': 'editorconfig',
  '.eslintrc': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.cjs': 'eslint',
  '.eslintrc.json': 'eslint',
  '.eslintrc.yaml': 'eslint',
  '.eslintrc.yml': 'eslint',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  'eslint.config.cjs': 'eslint',
  'eslint.config.ts': 'eslint',
  '.eslintignore': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.json': 'prettier',
  '.prettierrc.js': 'prettier',
  '.prettierrc.cjs': 'prettier',
  '.prettierrc.yaml': 'prettier',
  '.prettierrc.yml': 'prettier',
  'prettier.config.js': 'prettier',
  'prettier.config.cjs': 'prettier',
  '.prettierignore': 'prettier',
  'vite.config.js': 'vite',
  'vite.config.ts': 'vite',
  'vite.config.mjs': 'vite',
  'vitest.config.js': 'vitest',
  'vitest.config.ts': 'vitest',
  'vitest.config.mjs': 'vitest',
  'webpack.config.js': 'webpack',
  'rollup.config.js': 'rollup',
  'rollup.config.mjs': 'rollup',
  'rollup.config.ts': 'rollup',
  'tailwind.config.js': 'tailwindcss',
  'tailwind.config.ts': 'tailwindcss',
  'postcss.config.js': 'postcss',
  'jest.config.js': 'jest',
  'jest.config.ts': 'jest',
  'babel.config.js': 'babel',
  '.babelrc': 'babel',
  '.babelrc.json': 'babel',
  license: 'certificate',
  'license.txt': 'certificate',
  'license.md': 'certificate',
  copying: 'certificate',
  readme: 'readme',
  'readme.md': 'readme',
  'readme.txt': 'readme',
  changelog: 'changelog',
  'changelog.md': 'changelog',
  contributing: 'contributing',
  'contributing.md': 'contributing',
  'code_of_conduct.md': 'conduct',
  'pyproject.toml': 'python-misc',
  'requirements.txt': 'pip',
  'requirements-dev.txt': 'pip',
  'setup.py': 'python-misc',
  'setup.cfg': 'python-misc',
  'pipfile': 'python-misc',
  'pipfile.lock': 'python-misc',
  'cargo.toml': 'rust',
  'cargo.lock': 'rust',
  'go.mod': 'go-mod',
  'go.sum': 'go-mod',
  'gemfile': 'ruby',
  'gemfile.lock': 'ruby',
  'rakefile': 'ruby',
  '.env.local': 'tune',
  '.env.example': 'tune',
  '.env.development': 'tune',
  '.env.production': 'tune',
  '.env.test': 'tune',
};

// Map exact folder name (lowercased) → Material folder-icon basename.
// Generic `folder` is the fallback. Material also has `-open` variants
// but for our tree we stick to the closed form (the chevron already
// conveys expanded/collapsed state).
const FOLDER_ICON: Record<string, string> = {
  src: 'folder-src',
  app: 'folder-app',
  test: 'folder-test',
  tests: 'folder-test',
  __tests__: 'folder-test',
  spec: 'folder-test',
  specs: 'folder-test',
  e2e: 'folder-test',
  config: 'folder-config',
  '.config': 'folder-config',
  configs: 'folder-config',
  configuration: 'folder-config',
  views: 'folder-views',
  view: 'folder-views',
  pages: 'folder-views',
  panes: 'folder-views',
  layouts: 'folder-layout',
  components: 'folder-components',
  component: 'folder-components',
  utils: 'folder-utils',
  util: 'folder-utils',
  helpers: 'folder-helper',
  helper: 'folder-helper',
  lib: 'folder-lib',
  libs: 'folder-lib',
  shared: 'folder-shared',
  common: 'folder-shared',
  hooks: 'folder-hook',
  middleware: 'folder-middleware',
  models: 'folder-class',
  controllers: 'folder-controller',
  routes: 'folder-routes',
  api: 'folder-api',
  services: 'folder-server',
  server: 'folder-server',
  client: 'folder-client',
  images: 'folder-images',
  image: 'folder-images',
  img: 'folder-images',
  assets: 'folder-resource',
  public: 'folder-public',
  static: 'folder-public',
  docs: 'folder-docs',
  doc: 'folder-docs',
  documentation: 'folder-docs',
  examples: 'folder-examples',
  example: 'folder-examples',
  demo: 'folder-examples',
  demos: 'folder-examples',
  types: 'folder-typescript',
  typings: 'folder-typescript',
  styles: 'folder-css',
  css: 'folder-css',
  sass: 'folder-css',
  scripts: 'folder-scripts',
  bin: 'folder-tools',
  tools: 'folder-tools',
  scene: 'folder-3d',
  constants: 'folder-constant',
  constant: 'folder-constant',
  shell: 'folder-shared',
  store: 'folder-redux',
  stores: 'folder-redux',
  state: 'folder-redux',
  '.github': 'folder-github',
  '.git': 'folder-git',
  node_modules: 'folder-node',
  dist: 'folder-dist',
  build: 'folder-dist',
  out: 'folder-dist',
  output: 'folder-dist',
  coverage: 'folder-coverage',
  '.vscode': 'folder-vscode',
  '.idea': 'folder-intellij',
};

// Material's `document` glyph has more visual weight than the plain
// `file` outline — feels at home next to the colorful per-type icons
// instead of looking like an unloved placeholder. The onerror handler
// falls all the way back to `file` if `document` ever goes missing.
const GENERIC_FILE = 'document';
const GENERIC_FOLDER = 'folder';
const HARD_FALLBACK_FILE = 'file';
const HARD_FALLBACK_FOLDER = 'folder';

/**
 * Resolve the Material icon basename for a file node — same lookup
 * order makeFileIcon uses (exact filename > extension > generic).
 * Exported so the building roof-icon atlas can key off the same names.
 */
export function getFileIconName(
  file: FileNode | { name?: string; extension?: string }
): string {
  const name = (file.name || '').toLowerCase();
  const ext = (file.extension || '').toLowerCase();
  return NAME_ICON[name] ?? EXT_ICON[ext] ?? GENERIC_FILE;
}

/** Material icon basename for a folder — see getFileIconName. */
export function getFolderIconName(dir: DirNode | { name?: string }): string {
  const name = (dir.name || '').toLowerCase();
  return FOLDER_ICON[name] ?? GENERIC_FOLDER;
}

/** Base URL the atlas / tree both fetch icon SVGs from. */
export const FILE_ICON_CDN_BASE = ICON_CDN_BASE;

/** Build the <img> for a file node, with extension/name lookups + fallback. */
export function makeFileIcon(file: FileNode | { name?: string; extension?: string }): HTMLImageElement {
  return _makeIcon(getFileIconName(file), file.name || '');
}

/** Build the <img> for a folder node, with name lookup + generic fallback. */
export function makeFolderIcon(dir: DirNode | { name?: string }): HTMLImageElement {
  return _makeIcon(getFolderIconName(dir), dir.name || '');
}

function _makeIcon(iconName: string, label: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'file-icon';
  img.src = `${ICON_CDN_BASE}${iconName}.svg`;
  img.alt = ''; // decorative — the label next to it carries the name
  img.loading = 'lazy';
  // Defensive: if a less-common icon name 404s, fall back to the
  // generic file/folder glyph (once — guarded against infinite loops).
  // Second-chance fallback is the unconditionally-present `file` /
  // `folder` glyph so a typo in our map (or a removed icon in a
  // theme bump) can't leave the row with a broken-image marker.
  let fellBack = false;
  img.addEventListener('error', () => {
    if (fellBack) return;
    fellBack = true;
    const isFolder = iconName.startsWith('folder');
    // If the failure WAS the generic icon, jump straight to the hard
    // fallback to avoid a no-op same-url retry.
    const next =
      iconName === GENERIC_FOLDER || iconName === GENERIC_FILE
        ? isFolder
          ? HARD_FALLBACK_FOLDER
          : HARD_FALLBACK_FILE
        : isFolder
          ? GENERIC_FOLDER
          : GENERIC_FILE;
    img.src = `${ICON_CDN_BASE}${next}.svg`;
  });
  // Stash so callers can introspect during tests / debugging.
  if (typeof NodeKind !== 'undefined') {
    img.dataset.iconName = iconName;
    if (label) img.dataset.iconFor = label;
  }
  return img;
}
