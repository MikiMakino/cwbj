#!/usr/bin/env node
// intakeリポジトリに必要なラベルを作る。初回に一度だけ実行すればよい。
// ラベル名は config/site.json と完全に一致している必要があるため、手作業で作らずこれで作る。
// 既にある場合は色と説明だけ更新するので、何度実行しても安全。
//
//   使い方: node scripts/setup-labels.mjs
//   必要な環境変数: GITHUB_TOKEN（intakeリポジトリのissues:write）, INTAKE_REPO

import { loadConfig } from "./lib/config.mjs";
import { apiPaginate, apiRequest } from "./lib/github.mjs";

const config = loadConfig();
const token = process.env.GITHUB_TOKEN || process.env.INTAKE_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN が設定されていません");
if (!/^[\w.-]+\/[\w.-]+$/.test(config.intakeRepo)) {
  throw new Error(`intakeRepo の指定が不正です: "${config.intakeRepo}"（config/site.json か INTAKE_REPO を確認）`);
}

const wanted = [
  { name: config.labels.publish, color: "0E8A16", description: "このQ&Aを公開する" },
  { name: config.labels.review, color: "D93F0B", description: "自動チェックで公開を見送った項目" },
  { name: config.labels.piiAck, color: "FBCA04", description: "個人情報チェックの誤検知を承認する" },
  ...config.categories.map((category) => ({
    name: `cat:${category.id}`,
    color: "1D76DB",
    description: `カテゴリ: ${category.label}`,
  })),
];

const existing = new Set(
  (await apiPaginate(token, `/repos/${config.intakeRepo}/labels?per_page=100`)).map((label) => label.name),
);

for (const label of wanted) {
  if (existing.has(label.name)) {
    await apiRequest(token, "PATCH", `/repos/${config.intakeRepo}/labels/${encodeURIComponent(label.name)}`, {
      color: label.color,
      description: label.description,
    });
    console.log(`更新: ${label.name}`);
  } else {
    await apiRequest(token, "POST", `/repos/${config.intakeRepo}/labels`, label);
    console.log(`作成: ${label.name}`);
  }
}

console.log(`\n${wanted.length}件のラベルを ${config.intakeRepo} に用意しました。`);
