/**
 * 移除常見 Markdown 符號，回傳純文字。
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')        // ## 標題
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')  // **bold** / *italic* / ***
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')     // __bold__ / _italic_
    .replace(/~~([^~]+)~~/g, '$1')              // ~~strikethrough~~
    .replace(/`{3}[\s\S]*?`{3}/g, '')           // ```code block```
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
