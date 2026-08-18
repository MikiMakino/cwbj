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

/** **太字** と ~~取り消し線~~ だけを適用する。 */
function emphasize(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, (_m, body) => `<strong>${body}</strong>`)
    .replace(/~~([^~\n]+)~~/g, (_m, body) => `<del>${body}</del>`);
}

function renderInline(escaped) {
  // 組み立て済みの断片は退避しておき、最後にまとめて戻す。
  // エスケープ済みの文字列にNUL文字は残らないので、目印として使える。
  const parts = [];
  const stash = (html) => `\0${parts.push(html) - 1}\0`;

  // `code` の中身はMarkdownとして解釈しない
  let html = escaped.replace(/`([^`\n]+)`/g, (_m, code) => stash(`<code>${code}</code>`));

  // [text](https://...) — http / https のみ許可する。
  // URLごと退避しないと、href に含まれる ** や ~~ を強調として書き換えてしまう。
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) =>
    stash(`<a href="${url}" target="_blank" rel="noopener">${emphasize(label)}</a>`),
  );

  html = emphasize(html);

  // 退避した断片を戻す。断片の中に別の退避（リンク内のコードなど）があるため、無くなるまで繰り返す。
  let previous;
  do {
    previous = html;
    html = html.replace(/\0(\d+)\0/g, (_m, index) => parts[Number(index)]);
  } while (html !== previous);

  return html;
}

const BULLET = /^\s*[-*]\s+/;
const TASK = /^\[([ xX])\]\s+/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+/;
const QUOTE = /^\s*>\s?/;

function isBulletBlock(lines) {
  return lines.every((line) => BULLET.test(line));
}

function isOrderedBlock(lines) {
  return lines.every((line) => ORDERED.test(line));
}

function isQuoteBlock(lines) {
  return lines.every((line) => QUOTE.test(line));
}

/**
 * ``` で囲まれたコードブロックを先に取り出し、目印に置き換える。
 * 中身は空行を含みうるので、段落分割の前に抜き出しておく必要がある。
 * 目印は前後を空行で挟み、必ず独立したブロックとして扱われるようにする。
 */
function extractFencedCode(source) {
  const lines = source.split("\n");
  const blocks = [];
  const output = [];
  let fence = null;

  for (const line of lines) {
    const opening = line.match(/^\s*```\s*([\w+#-]{0,20})\s*$/);

    if (!fence && opening) {
      fence = { lang: opening[1], body: [] };
      continue;
    }
    if (fence && /^\s*```\s*$/.test(line)) {
      output.push("", `\0FENCE${blocks.push(buildCodeBlock(fence)) - 1}\0`, "");
      fence = null;
      continue;
    }
    (fence ? fence.body : output).push(line);
  }

  // 閉じ忘れは、そこまでをコードブロックとして扱う（GitHubの表示と同じ）
  if (fence) output.push("", `\0FENCE${blocks.push(buildCodeBlock(fence)) - 1}\0`, "");

  return { text: output.join("\n"), blocks };
}

function buildCodeBlock(fence) {
  const className = fence.lang ? ` class="language-${escapeHtml(fence.lang)}"` : "";
  return `<pre><code${className}>${escapeHtml(fence.body.join("\n"))}</code></pre>`;
}

/**
 * 段落・箇条書き・太字・コード・コードブロック・リンクだけをサポートする最小のMarkdownレンダラ。
 * 見出しは太字の段落に落とす（FAQの回答欄に見出し階層は不要なため）。
 */
export function renderMarkdown(source) {
  const normalized = String(source || "").replace(/\r\n?/g, "\n").replace(/\0/g, "").trim();
  if (!normalized) return "";

  const { text, blocks } = extractFencedCode(normalized);

  return text
    .split(/\n{2,}/)
    .map((block) => {
      const fenced = block.trim().match(/^\0FENCE(\d+)\0$/);
      if (fenced) return blocks[Number(fenced[1])];

      const lines = block.split("\n").filter((line) => line.trim() !== "");
      if (lines.length === 0) return "";

      if (isBulletBlock(lines)) {
        let hasTask = false;
        const items = lines
          .map((line) => {
            const body = line.replace(BULLET, "");
            const task = body.match(TASK);
            if (!task) return `<li>${renderInline(escapeHtml(body))}</li>`;

            // 状態を示すだけの表示なので、操作できないチェックボックスにする
            hasTask = true;
            const checked = task[1].toLowerCase() === "x" ? " checked" : "";
            const label = renderInline(escapeHtml(body.replace(TASK, "")));
            return `<li class="task"><input type="checkbox" disabled${checked}><span>${label}</span></li>`;
          })
          .join("");
        return `<ul${hasTask ? ' class="task-list"' : ""}>${items}</ul>`;
      }

      if (isOrderedBlock(lines)) {
        const first = Number(lines[0].match(ORDERED)[1]);
        const items = lines
          .map((line) => renderInline(escapeHtml(line.replace(ORDERED, ""))))
          .map((item) => `<li>${item}</li>`)
          .join("");
        // 1以外から始まる場合は、書かれた番号どおりに見えるようにする
        return `<ol${first === 1 ? "" : ` start="${first}"`}>${items}</ol>`;
      }

      if (isQuoteBlock(lines)) {
        const text = lines.map((line) => renderInline(escapeHtml(line.replace(QUOTE, "")))).join("<br>");
        return `<blockquote><p>${text}</p></blockquote>`;
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
