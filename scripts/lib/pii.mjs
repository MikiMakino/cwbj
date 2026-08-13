// 公開前の最後の関門。人の目視チェックを置き換えるものではなく、
// 「見落としたまま公開されること」を防ぐための機械的なストッパー。
// 検知したら公開せず、Issueに差し戻す。

// 日本語入力で現れるハイフン類。区切り文字として扱う場所すべてでこの集合を使う。
// ASCII のハイフンを先頭に置いているので、文字クラスに埋めても範囲指定にならない。
const HYPHENS = "-‐−ー－";

const RULES = [
  {
    id: "email",
    label: "メールアドレス",
    pattern: /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g,
  },
  {
    id: "phone",
    label: "電話番号らしき数字",
    pattern: new RegExp(`0\\d{1,4}[${HYPHENS}\\s(]?\\d{1,4}[${HYPHENS}\\s)]?\\d{3,4}(?!\\d)`, "g"),
  },
  {
    id: "phone-fullwidth",
    label: "電話番号らしき数字（全角）",
    pattern: new RegExp(`０[０-９]{1,4}[${HYPHENS}\\s（]?[０-９]{1,4}[${HYPHENS}\\s）]?[０-９]{3,4}`, "g"),
  },
  {
    id: "postal",
    label: "郵便番号",
    // 前後にハイフンや数字が続くものは電話番号側で拾うため、ここでは除く（090-1234-5678 を郵便番号と報告しない）
    pattern: new RegExp(
      `〒\\s*\\d{3}[${HYPHENS}]?\\d{4}|(?<![${HYPHENS}\\d])\\d{3}[${HYPHENS}]\\d{4}(?![${HYPHENS}\\d])`,
      "g",
    ),
  },
  {
    id: "social",
    label: "SNS・個人プロフィールのURL",
    pattern: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com\/in|note\.com|github\.com)\/[\w.-]+/gi,
  },
  {
    id: "mention",
    label: "@から始まるアカウント名",
    // 直前の文字は後読みで判定するだけにして、マッチ自体はアカウント名に限定する
    // （区切り文字を含めると、差し戻しコメントのサンプルが "(@alice" のようになる）。
    // 直前が英数字なら taro@example.com のようなアドレスなので、メールアドレス側に任せる。
    pattern: /(?<![\w@])@[A-Za-z0-9_-]{2,}/g,
  },
];

/**
 * @returns {{id: string, label: string, samples: string[]}[]} 検知した項目。空配列なら公開可。
 */
export function scanPii(text) {
  const target = String(text || "");
  const hits = [];

  for (const rule of RULES) {
    const matches = target.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    hits.push({
      id: rule.id,
      label: rule.label,
      samples: [...new Set(matches.map((m) => m.trim()))].slice(0, 5),
    });
  }
  return hits;
}

/**
 * 検知した文字列を、Markdownのインラインコードとして安全に囲む。
 * 中身にバッククォートが含まれても崩れないよう、含まれる連続数より1つ長い記号で囲む
 * （両端がバッククォートのときは空白を足す。CommonMarkはこの空白を1つだけ取り除く）。
 * 改行や連続する空白も、箇条書きが分断されないよう1つの半角空白にまとめる。
 */
function toInlineCode(sample) {
  const value = String(sample).replace(/\s+/g, " ").trim();
  const longestRun = (value.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

/** 検知結果を、そのままIssueコメントに貼れる日本語の文面にする。 */
export function formatPiiReport(hits) {
  const lines = hits.map((hit) => `- ${hit.label}: ${hit.samples.map(toInlineCode).join(", ")}`);
  return lines.join("\n");
}

export const piiRuleIds = RULES.map((rule) => rule.id);
