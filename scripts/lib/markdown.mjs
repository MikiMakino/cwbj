// Issue本文・コメントは外部から届いた文字列なので、必ずエスケープしてから
// 限定的なMarkdownだけをHTMLに戻す。生HTMLは一切通さない。

export function escapeHtml(text) {
  return String(text)
    .replace(/\0/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(escaped) {
  // `code` の中身はMarkdownとして解釈しない。先に退避しておき、最後に戻す。
  // エスケープ済みの文字列にNUL文字は残らないので、目印として使える。
  const codes = [];
  let html = escaped.replace(/`([^`\n]+)`/g, (_m, code) => `\0${codes.push(code) - 1}\0`);

  // [text](https://...) — http / https のみ許可する
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
  });

  // **bold**
  html = html.replace(/\*\*([^*\n]+)\*\*/g, (_m, body) => `<strong>${body}</strong>`);

  return html.replace(/\0(\d+)\0/g, (_m, index) => `<code>${codes[Number(index)]}</code>`);
}

function isListBlock(lines) {
  return lines.every((line) => /^\s*[-*]\s+/.test(line));
}

/**
 * 段落・箇条書き・太字・コード・リンクだけをサポートする最小のMarkdownレンダラ。
 * 見出しは太字の段落に落とす（FAQの回答欄に見出し階層は不要なため）。
 */
export function renderMarkdown(source) {
  const normalized = String(source || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  return normalized
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter((line) => line.trim() !== "");
      if (lines.length === 0) return "";

      if (isListBlock(lines)) {
        const items = lines
          .map((line) => renderInline(escapeHtml(line.replace(/^\s*[-*]\s+/, ""))))
          .map((item) => `<li>${item}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      const text = lines
        .map((line) => renderInline(escapeHtml(line.replace(/^\s*#{1,6}\s+/, ""))))
        .join("<br>");
      const wasHeading = /^\s*#{1,6}\s+/.test(lines[0]) && lines.length === 1;
      return wasHeading ? `<p><strong>${text}</strong></p>` : `<p>${text}</p>`;
    })
    .filter(Boolean)
    .join("");
}
