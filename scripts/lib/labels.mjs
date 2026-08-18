// 公開してよいかをラベルだけで判断する部分。
// 「公開」「レビュー済」「PII確認済」の3つが揃って初めて公開の対象になる。
// 1つでも欠けていれば、内容の検査に進まず「公開待ち」として保留する。

/**
 * Issueのラベル名を配列で返す（APIは文字列と {name} の両方を返しうる）。
 * 名前を取り出せない要素は捨てる。ここで例外を投げると公開処理全体が止まるため、
 * 想定外の形が混ざっても「そのラベルは無い」として扱う。
 */
export function labelNamesOf(issue) {
  return (issue?.labels || [])
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter((name) => typeof name === "string" && name.length > 0);
}

/** 公開の前提になる3つのラベル。この3つが揃って初めて内容の検査に進む。 */
export const REQUIRED_LABEL_KEYS = ["publish", "reviewed", "piiReviewed"];

/** 上の3つに、差し戻しに使う `review`（要確認）を加えた、設定に必要な全キー。 */
export const ALL_LABEL_KEYS = [...REQUIRED_LABEL_KEYS, "review"];

/**
 * ラベル名が設定されているか確かめる。
 * 欠けたまま進むと「undefined ラベルがありません」といった意味不明な理由で
 * 全件が公開待ちになるため、どのキーが足りないかを明示して止める。
 */
export function assertLabelNames(config, keys = ALL_LABEL_KEYS) {
  for (const key of keys) {
    const name = config?.labels?.[key];
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`labels.${key} が未設定です（config/site.json のラベル名を確認してください）`);
    }
  }
}

export function requiredLabelsOf(config) {
  assertLabelNames(config, REQUIRED_LABEL_KEYS);
  return REQUIRED_LABEL_KEYS.map((key) => config.labels[key]);
}

/**
 * 公開に必要なラベルのうち、まだ付いていないものを返す。
 * @returns {string[]} 空配列なら3つ揃っている
 */
export function missingRequiredLabels(issue, config) {
  const names = labelNamesOf(issue);
  return requiredLabelsOf(config).filter((label) => !names.includes(label));
}
