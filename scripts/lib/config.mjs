import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadConfig() {
  const config = JSON.parse(readFileSync(join(repoRoot, "config", "site.json"), "utf8"));

  // 環境変数で上書きできるのは、リポジトリ名とFormsのURLだけ。
  // カテゴリや掲載ラベルはリポジトリ内の設定を正とする。
  if (process.env.INTAKE_REPO) config.intakeRepo = process.env.INTAKE_REPO;
  if (process.env.FORMS_URL) config.formsUrl = process.env.FORMS_URL;

  const ids = new Set(config.categories.map((c) => c.id));
  if (!ids.has(config.defaultCategory)) {
    throw new Error(`defaultCategory "${config.defaultCategory}" が categories に存在しません`);
  }
  return config;
}

export function pathIn(...parts) {
  return join(repoRoot, ...parts);
}
