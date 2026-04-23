/**
 * 移除常見 Markdown 符號，回傳純文字。
 *
 * 例外：AUDIO PROFILE preamble 的 `#` / `##` 標題視為結構標記（不是排版
 * Markdown），必須原樣保留，後端 parser (lib/scriptFormat.ts) 依賴這些標記
 * 判斷新/舊 preamble 格式：
 *   # AUDIO PROFILE
 *   ## Speaker1: ...
 *   ## Speaker2: ...
 *   # SCENE
 *   # SAMPLE CONTEXT
 */
const PRESERVED_HEADING_RE =
  /^(#\s*(AUDIO PROFILE|SCENE|SAMPLE CONTEXT)\s*$|##\s*Speaker[12]\s*[:：])/;

export function stripMarkdown(text: string): string {
  const normalized = text
    // Preserve fenced code block contents instead of deleting everything inside.
    .replace(/```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g, '$1')
    .replace(/^```(?:[a-zA-Z0-9_-]+)?\s*$/gm, '')
    .replace(/^```\s*$/gm, '');

  // Strip '#' / '##' from Markdown headings except structural preamble ones.
  const headingStripped = normalized
    .split('\n')
    .map(line =>
      PRESERVED_HEADING_RE.test(line.trim())
        ? line
        : line.replace(/^#{1,6}\s+/, ''),
    )
    .join('\n');

  return headingStripped
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // **bold** / *italic* / ***
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')     // __bold__ / _italic_
    .replace(/~~([^~]+)~~/g, '$1')              // ~~strikethrough~~
    .replace(/`([^`]+)`/g, '$1')                // `inline code`
    .replace(/^\s*[-*+]\s+/gm, '')              // - / * / + 清單項目
    .replace(/^\s*\d+\.\s+/gm, '')              // 1. 有序清單
    .replace(/^>\s+/gm, '')                     // > blockquote
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')     // ![image](url)
    .replace(/^[-*_]{3,}\s*$/gm, '')            // --- 分隔線
    .replace(/\n{3,}/g, '\n\n')                 // 多餘空行
    .trim();
}
