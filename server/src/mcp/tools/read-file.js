/**
 * Tool: read_file
 *
 * Read file contents with optional line range. PDF, Word, PowerPoint, RTF and
 * ODT come back as extracted Markdown (`documents.js`, v5.29), numbered and
 * paged like any text; any other binary file is refused rather than decoded.
 */

import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import { displayPath } from '../../core/paths.js';
import { documentKind, extractDocument, looksBinary } from './documents.js';

// Language detection by extension
const LANG_MAP = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.sql': 'sql',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.txt': 'plaintext',
  '.env': 'dotenv',
  '.dockerfile': 'dockerfile',
  '.graphql': 'graphql', '.gql': 'graphql',
};

export async function readFile(args, context) {
  const { path: filePath, startLine, endLine } = args;
  const { workspace } = context;

  const absPath = filePath.startsWith('/') ? filePath : resolve(workspace, filePath);
  // Relative inside the workspace, absolute outside it. These tools accept
  // absolute paths, and a bare `relative()` turns one into `../../../tmp/x`
  // in the error the model then reads — a path it never used.
  const relPath = displayPath(workspace, absPath);

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${relPath}`);
  }

  const stat = statSync(absPath);
  if (stat.isDirectory()) {
    throw new Error(`${relPath} is a directory. Use list_directory instead.`);
  }

  const kind = documentKind(absPath);
  let content;
  let language = null;
  if (kind) {
    // A document is paged after extraction, so its own size limit is about
    // the extraction, not the prompt: a 40-page PDF is easily several MB.
    if (stat.size > 50 * 1024 * 1024) {
      throw new Error(`Document too large to extract (${formatBytes(stat.size)}, limit 50 MB).`);
    }
    const doc = await extractDocument(absPath, stat, kind);
    if (doc.scanned) {
      return {
        path: relPath,
        language: doc.label,
        totalLines: 1,
        range: { start: 1, end: 1 },
        size: formatBytes(stat.size),
        content: `   1: (no text layer: ${doc.pages} page${doc.pages === 1 ? '' : 's'} of images, a scan. `
          + 'Nothing can be extracted. If you need what is on them, ask the user to paste the pages as images.)',
      };
    }
    content = doc.text;
    language = doc.label;
  } else {
    // Size guard — don't read files larger than 1MB
    if (stat.size > 1024 * 1024) {
      throw new Error(`File too large (${formatBytes(stat.size)}). Use startLine/endLine to read a portion.`);
    }
    const raw = readFileSync(absPath);
    // Decoding a binary file as UTF-8 handed the model thousands of characters
    // of noise, typed into the browser tab. Refused, and the refusal says what
    // can be read.
    if (looksBinary(raw)) {
      throw new Error(`${relPath} is a binary file (${formatBytes(stat.size)}) and cannot be read as text. `
        + 'read_file reads text, PDF, Word (.docx, .doc), PowerPoint (.pptx), RTF and ODT.');
    }
    content = raw.toString('utf-8');
  }
  const allLines = content.split('\n');
  const totalLines = allLines.length;

  // Apply line range and 800-line pagination limit
  let rangeStart = startLine ? Math.max(1, startLine) : 1;
  let rangeEnd = endLine ? Math.min(totalLines, endLine) : totalLines;

  if (rangeStart > totalLines) {
    throw new Error(`Start line ${rangeStart} exceeds file length (${totalLines} lines)`);
  }

  // Enforce 800-line limit to protect context window
  if (rangeEnd - rangeStart + 1 > 800) {
    rangeEnd = rangeStart + 800 - 1;
  }

  const lines = allLines.slice(rangeStart - 1, rangeEnd);

  // Add line numbers
  let numberedContent = lines
    .map((line, i) => `${String(rangeStart + i).padStart(4)}: ${line}`)
    .join('\n');

  if (rangeEnd < totalLines) {
    numberedContent += `\n\n... [File truncated at line ${rangeEnd} of ${totalLines}. Call read_file with startLine=${rangeEnd + 1} to read more.]`;
  }

  const ext = extname(absPath).toLowerCase();
  if (MARKDOWN.has(ext)) numberedContent += unreadOutline(allLines, rangeStart, rangeEnd);
  language ??= LANG_MAP[ext] || 'plaintext';

  return {
    path: relPath,
    language,
    totalLines,
    range: { start: rangeStart, end: rangeEnd },
    size: formatBytes(stat.size),
    content: numberedContent,
  };
}

const MARKDOWN = new Set(['.md', '.markdown', '.mdx']);
const OUTLINE_MAX = 40;

/**
 * The headings of a Markdown file that a partial read did not show (v6.14).
 *
 * Asked "what is the architecture of this agent", the model read README lines
 * 1–100 and 90–150 and answered from those. The pointer to CLAUDE.md, where
 * the architecture is, was at line 258 under `## More`, and nothing in the
 * read said that section existed. A document's headings are its table of
 * contents; a read of part of it now ends with the rest of that table, so the
 * next read can be aimed rather than paged.
 *
 * `#` to `###` only, fenced code skipped. Written `- ## More (line 258)`, never
 * `258: …`, because `fitReadResult` reads a leading number as a shown line.
 */
export function unreadOutline(allLines, start, end) {
  if (start <= 1 && end >= allLines.length) return '';
  const out = [];
  let fence = false;
  allLines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    const n = i + 1;
    if (fence || (n >= start && n <= end)) return;
    const m = /^(#{1,3})\s+(\S.*)$/.exec(line);
    if (m) out.push(`- ${m[1]} ${m[2].length > 70 ? `${m[2].slice(0, 69)}…` : m[2]} (line ${n})`);
  });
  if (!out.length) return '';
  const more = out.length > OUTLINE_MAX ? `\n- … ${out.length - OUTLINE_MAX} more` : '';
  return `\n\nHeadings outside lines ${start}–${end}:\n${out.slice(0, OUTLINE_MAX).join('\n')}${more}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
