#!/usr/bin/env node
// 表示用のデータを組み立てる。
//
//   data/curated.json … 運営が手で書く常設のQ&A
//   data/intake.json  … Formsから届いた質問（collect-issues.mjs が生成）
//        ↓ マージ・並べ替え・Markdown→HTML変換
//   data/faq.json     … index.html が読み込むファイル
//
// MarkdownのHTML化をここで済ませることで、ブラウザ側は受け取ったHTMLを差し込むだけで済む。
// 変換は必ずエスケープを通す（scripts/lib/markdown.mjs）。
//
//   使い方: node scripts/build-data.mjs [--check]
//     --check … 生成結果が data/faq.json と一致するか確認するだけ（書き込まない）

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfig, pathIn } from "./lib/config.mjs";
import { renderMarkdown } from "./lib/markdown.mjs";

const checkOnly = process.argv.includes("--check");
const config = loadConfig();

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

// "#" は「フォーム未設定」を表す。それ以外は https でなければページ側で無視され、原因が分かりにくい。
if (config.formsUrl !== "#" && !config.formsUrl.startsWith("https://")) {
  throw new Error(`formsUrl は "#" か https:// で始まるURLにしてください: "${config.formsUrl}"`);
}

const curated = readJson(pathIn("data", "curated.json"), { entries: [] });
const intake = readJson(pathIn("data", "intake.json"), { entries: [] });

// 常設のQ&Aが先、Formsから届いた質問が後。カテゴリ内の並びは登録順・Issue番号順で固定する。
const entries = [
  ...(curated.entries || []).map((entry, index) => ({ ...entry, order: index })),
  ...(intake.entries || []).map((entry) => ({ ...entry, order: Number.MAX_SAFE_INTEGER })),
];

const unknown = entries.filter((entry) => !config.categories.some((category) => category.id === entry.category));
if (unknown.length > 0) {
  throw new Error(`未定義のカテゴリが含まれています: ${unknown.map((e) => `#${e.id}(${e.category})`).join(", ")}`);
}

const duplicated = entries.map((entry) => String(entry.id)).filter((id, index, all) => all.indexOf(id) !== index);
if (duplicated.length > 0) {
  throw new Error(`IDが重複しています: ${[...new Set(duplicated)].join(", ")}`);
}

const missing = entries.filter((entry) => !String(entry.question || "").trim() || !String(entry.answer || "").trim());
if (missing.length > 0) {
  throw new Error(`質問文または回答が空の項目があります: ${missing.map((e) => `#${e.id}`).join(", ")}`);
}

const categoryOrder = new Map(config.categories.map((category, index) => [category.id, index]));
entries.sort(
  (a, b) =>
    categoryOrder.get(a.category) - categoryOrder.get(b.category) ||
    a.order - b.order ||
    String(a.id).localeCompare(String(b.id), "en", { numeric: true }),
);

const payload = {
  // 実行時刻ではなく内容から決める。中身が変わらなければ差分も出ない。
  updatedAt: entries.reduce((latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest), ""),
  formsUrl: config.formsUrl,
  categories: config.categories,
  entries: entries.map((entry) => ({
    id: String(entry.id),
    category: entry.category,
    question: String(entry.question).replace(/\s+/g, " ").trim(),
    answerHtml: renderMarkdown(entry.answer),
    updatedAt: entry.updatedAt || "",
  })),
};

const outPath = pathIn("data", "faq.json");
const json = `${JSON.stringify(payload, null, 2)}\n`;

if (checkOnly) {
  if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== json) {
    console.error("data/faq.json が curated.json・intake.json と一致しません。node scripts/build-data.mjs を実行してください。");
    process.exit(1);
  }
  console.log("data/faq.json は最新です。");
} else {
  writeFileSync(outPath, json, "utf8");
  console.log(`data/faq.json を生成しました（常設 ${curated.entries?.length ?? 0}件 / Forms経由 ${intake.entries?.length ?? 0}件）`);
}
