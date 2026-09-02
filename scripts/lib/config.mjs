import { readFileSync } from "node:fs";
import { assertLabelNames } from "./labels.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig() {
  const config = JSON.parse(readFileSync(join(repoRoot, "config", "site.json"), "utf8"));

  // 環境変数で上書きできるのは、リポジトリ名とFormsのURLだけ。
  // カテゴリや掲載ラベルはリポジトリ内の設定を正とする。
  if (process.env.INTAKE_REPO) config.intakeRepo = process.env.INTAKE_REPO;
  if (process.env.FORMS_URL) config.formsUrl = process.env.FORMS_URL;

  // null/undefined/真偽値は文字列化すると "null"/"undefined"/"true" のようにそれらしい形になり、
  // 下の正規表現チェックをすり抜けてしまう。先に型で弾いて、原因が分かるエラーにする。
  const nonStringIds = config.categories.filter((c) => typeof c.id !== "string");
  if (nonStringIds.length > 0) {
    throw new Error(`categories の id は文字列である必要があります: ${JSON.stringify(nonStringIds.map((c) => c.id))}`);
  }
  // ここから先、categoryIds は検証済みの文字列だけを持つ。
  const categoryIds = config.categories.map((c) => c.id);
  const seen = new Set();
  const duplicated = new Set();
  categoryIds.forEach((id) => (seen.has(id) ? duplicated.add(id) : seen.add(id)));
  if (duplicated.size > 0) {
    throw new Error(`categories の id が重複しています: ${[...duplicated].join(", ")}`);
  }
  // index.html で id="cat-<id>" ／ data-category="<id>" としてそのまま使うため、
  // CSS/HTMLのidとして安全な形（先頭は英小文字、以降は英小文字・数字・ハイフン）に限定する。
  const invalidIds = categoryIds.filter((id) => !/^[a-z][a-z0-9-]*$/.test(id));
  if (invalidIds.length > 0) {
    throw new Error(`categories の id は英小文字で始まる英小文字・数字・ハイフンのみ使用できます: ${invalidIds.join(", ")}`);
  }
  if (!seen.has(config.defaultCategory)) {
    throw new Error(`defaultCategory "${config.defaultCategory}" が categories に存在しません`);
  }

  // ラベル名が欠けていても実行自体は続いてしまい、「1件も公開されない」「undefined という名前の
  // ラベルが作られる」といった分かりにくい形で表面化する。読み込みの時点で止める。
  assertLabelNames(config);

  return config;
}

export function pathIn(...parts) {
  return join(repoRoot, ...parts);
}
