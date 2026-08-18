#!/usr/bin/env node
// intakeリポジトリ（private）の「公開」ラベル付きIssueを集めて data/intake.json を作る。
// このスクリプトはintakeリポジトリのワークフローから実行される想定。
// 公開できない項目は intake.json に含めず、Issue側に差し戻しコメントを残す。
// 表示用の data/faq.json は、このあと build-data.mjs が組み立てる。
//
//   使い方: node scripts/collect-issues.mjs [--out data/intake.json] [--dry-run]
//   必要な環境変数: GITHUB_TOKEN（intakeリポジトリのissues:write）, INTAKE_REPO

import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { loadConfig, pathIn } from "./lib/config.mjs";
import { apiPaginate, apiRequest } from "./lib/github.mjs";
import { parseIssue } from "./lib/parse-issue.mjs";
import { labelNamesOf, missingRequiredLabels } from "./lib/labels.mjs";
import { scanPii, formatPiiReport } from "./lib/pii.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outArg = args.indexOf("--out");
if (outArg !== -1 && !args[outArg + 1]) throw new Error("--out には出力先のパスを指定してください");
const outPath = outArg === -1 ? pathIn("data", "intake.json") : args[outArg + 1];

const config = loadConfig();
const token = process.env.GITHUB_TOKEN || process.env.INTAKE_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN が設定されていません");
if (!/^[\w.-]+\/[\w.-]+$/.test(config.intakeRepo)) {
  throw new Error(`intakeRepo の指定が不正です: "${config.intakeRepo}"（config/site.json か INTAKE_REPO を確認）`);
}

const summaryLines = [];
function note(line) {
  summaryLines.push(line);
  console.log(line);
}

function fingerprint(problems, piiHits) {
  const seed = JSON.stringify([problems, piiHits.map((h) => [h.id, h.samples])]);
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/** 同じ指摘を何度も貼らないよう、指摘内容のハッシュをコメントに埋めて重複を避ける。 */
async function reportBack(issue, comments, problems, piiHits) {
  const marker = `<!-- cwbj-faq-check:${fingerprint(problems, piiHits)} -->`;
  if (comments.some((comment) => String(comment.body || "").includes(marker))) return;

  const body = [
    marker,
    "**このIssueは公開されませんでした。** 下記を直してください。",
    "",
    ...(problems.length > 0 ? ["**不足している項目**", ...problems.map((p) => `- ${p}`), ""] : []),
    ...(piiHits.length > 0
      ? [
          "**個人情報の可能性がある記述**",
          formatPiiReport(piiHits),
          "",
          "該当箇所は削除するか、サンプル値に書き換えてください。自動チェックを飛ばす方法はありません。",
          "",
        ]
      : []),
    "**直したあと**",
    `- 回答コメントを編集すれば、その時点で自動的に再判定されます（ラベルの操作は不要です）`,
    `- すぐに反映したいときは、Actions の \`Publish FAQ\` を手動実行してください`,
    `- 公開できる状態になれば、\`${config.labels.review}\` ラベルは自動で外れます`,
  ].join("\n");

  if (dryRun) {
    console.log(`  [dry-run] Issue #${issue.number} へのコメントを省略しました`);
    return;
  }

  await apiRequest(token, "POST", `/repos/${config.intakeRepo}/issues/${issue.number}/comments`, { body });
  if (!labelNamesOf(issue).includes(config.labels.review)) {
    await apiRequest(token, "POST", `/repos/${config.intakeRepo}/issues/${issue.number}/labels`, {
      labels: [config.labels.review],
    });
  }
}

async function clearReviewLabel(issue) {
  if (dryRun || !labelNamesOf(issue).includes(config.labels.review)) return;
  const path = `/repos/${config.intakeRepo}/issues/${issue.number}/labels/${encodeURIComponent(config.labels.review)}`;
  await apiRequest(token, "DELETE", path);
}

async function main() {
  const issues = (
    await apiPaginate(
      token,
      `/repos/${config.intakeRepo}/issues?state=all&per_page=100&labels=${encodeURIComponent(config.labels.publish)}`,
    )
  ).filter((issue) => !issue.pull_request);

  note(`「${config.labels.publish}」ラベル付きIssue: ${issues.length}件（${config.intakeRepo}）`);

  const entries = [];
  const skipped = [];
  const waiting = [];

  for (const issue of issues) {
    // ラベルが揃っていないものは「まだ確認の途中」なので、
    // 差し戻しコメントは付けず、保留として記録するだけにする。
    const missingLabels = missingRequiredLabels(issue, config);
    if (missingLabels.length > 0) {
      const reasons = missingLabels.map((label) => `「${label}」ラベルがありません`);
      waiting.push({ number: issue.number, reasons });
      note(`  #${issue.number} 公開待ち: ${reasons.join(" / ")}`);
      continue;
    }

    const comments = await apiPaginate(token, `/repos/${config.intakeRepo}/issues/${issue.number}/comments?per_page=100`);
    const { entry, problems } = parseIssue(issue, comments, config);

    const piiTarget = entry ? `${entry.question}\n${entry.answer}` : "";
    const piiHits = entry ? scanPii(piiTarget) : [];

    if (!entry || piiHits.length > 0) {
      const reasons = [...problems, ...piiHits.map((hit) => `${hit.label}を検知`)];
      skipped.push({ number: issue.number, reasons });
      note(`  #${issue.number} 公開見送り: ${reasons.join(" / ")}`);
      await reportBack(issue, comments, problems, piiHits);
      continue;
    }

    await clearReviewLabel(issue);
    entries.push(entry);
  }

  const categoryOrder = new Map(config.categories.map((category, index) => [category.id, index]));
  entries.sort((a, b) => (categoryOrder.get(a.category) - categoryOrder.get(b.category)) || (a.id - b.id));

  const payload = {
    // 実行時刻ではなく内容から決める。差分が出ないときはコミットも発生させない。
    updatedAt: entries.reduce((latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest), ""),
    source: { repo: config.intakeRepo, label: config.labels.publish },
    entries: entries.map(({ id, category, question, answer, updatedAt }) => ({
      id,
      category,
      question,
      answer,
      updatedAt,
    })),
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  note(`公開: ${entries.length}件 / 公開待ち: ${waiting.length}件 / 見送り: ${skipped.length}件 → ${outPath}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### FAQ収集結果\n\n${summaryLines.join("\n\n")}\n`, "utf8");
  }
}

await main();
