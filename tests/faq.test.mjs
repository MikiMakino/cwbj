import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown, escapeHtml } from "../scripts/lib/markdown.mjs";
import { scanPii, formatPiiReport } from "../scripts/lib/pii.mjs";
import { parseIssue, parseSections, pickAnswer, pickCategory } from "../scripts/lib/parse-issue.mjs";

const config = {
  defaultCategory: "ask",
  categories: [
    { id: "ask", label: "質問・相談について" },
    { id: "privacy", label: "プライバシーについて" },
    { id: "site", label: "このサイトについて" },
  ],
};

const issue = (overrides = {}) => ({
  number: 12,
  title: "GitHubアカウントは必要ですか？",
  body: "### 質問\n必要か知りたいです。\n\n### カテゴリ\nこのサイトについて",
  labels: [{ name: "公開" }],
  updated_at: "2026-08-10T01:00:00Z",
  ...overrides,
});

const comment = (body, association = "OWNER") => ({ id: 1, body, author_association: association });

test("回答本文のHTMLはエスケープされる", () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

test("リンクはhttp/httpsだけをアンカーにする", () => {
  assert.ok(renderMarkdown("[案内](https://example.com/a)").includes('<a href="https://example.com/a"'));
  assert.ok(!renderMarkdown("[危険](javascript:alert(1))").includes("<a "));
});

test("インラインコードの中はMarkdownとして解釈しない", () => {
  assert.equal(renderMarkdown("`**そのまま**`"), "<p><code>**そのまま**</code></p>");
  assert.equal(renderMarkdown("`[表示](https://example.com)`"), "<p><code>[表示](https://example.com)</code></p>");
  assert.equal(renderMarkdown("**太字**と`コード`"), "<p><strong>太字</strong>と<code>コード</code></p>");
});

test("箇条書きと段落を組み立てる", () => {
  const html = renderMarkdown("最初の段落\n2行目\n\n- 一つ目\n- 二つ目");
  assert.equal(html, "<p>最初の段落<br>2行目</p><ul><li>一つ目</li><li>二つ目</li></ul>");
});

test("escapeHtmlは引用符も落とす", () => {
  assert.equal(escapeHtml(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
});

test("個人情報らしき記述を検知する", () => {
  assert.equal(scanPii("メールはtaro@example.comです").at(0).id, "email");
  assert.equal(scanPii("連絡先は090-1234-5678").at(0).id, "phone");
  assert.equal(scanPii("担当は @taro_dev です").at(0).id, "mention");
  assert.equal(scanPii("https://x.com/someone を見てください").at(0).id, "social");
});

test("アカウント名のサンプルに区切り文字を含めない", () => {
  assert.deepEqual(scanPii("連絡は (@alice) へ").at(0).samples, ["@alice"]);
  assert.deepEqual(scanPii("@bob さんへ").at(0).samples, ["@bob"]);
  assert.deepEqual(scanPii("担当は（@carol）です").at(0).samples, ["@carol"]);
});

test("メールアドレスをアカウント名として二重に報告しない", () => {
  assert.deepEqual(scanPii("メールはtaro@example.comです").map((hit) => hit.id), ["email"]);
});

test("郵便番号は〒付きでも単体でも検知する", () => {
  assert.equal(scanPii("〒150-0001 に送ってください").at(0).id, "postal");
  assert.equal(scanPii("住所は150-0001です").at(0).id, "postal");
});

test("日本語入力のハイフン類でも郵便番号を検知する", () => {
  for (const hyphen of ["-", "‐", "−", "ー", "－"]) {
    const hits = scanPii(`住所は150${hyphen}0001です`);
    assert.equal(hits.at(0)?.id, "postal", `区切り文字「${hyphen}」を検知できていません`);
  }
});

test("電話番号を郵便番号として二重に報告しない", () => {
  assert.deepEqual(scanPii("連絡先は090-1234-5678").map((hit) => hit.id), ["phone"]);
  assert.deepEqual(scanPii("連絡先は090ー1234ー5678").map((hit) => hit.id), ["phone"]);
});

test("個人情報を含まない文章は素通しする", () => {
  assert.deepEqual(scanPii("運営内で確認し、公開可能なものだけを掲載しています。"), []);
});

test("差し戻しコメントは検体ごとにインラインコードで囲む", () => {
  const report = formatPiiReport([{ id: "email", label: "メールアドレス", samples: ["a@example.com", "b@example.com"] }]);
  assert.equal(report, "- メールアドレス: `a@example.com`, `b@example.com`");
});

test("検体にバッククォートが含まれてもMarkdownが崩れない", () => {
  assert.equal(formatPiiReport([{ id: "x", label: "検体", samples: ["a`b"] }]), "- 検体: ``a`b``");
  assert.equal(formatPiiReport([{ id: "x", label: "検体", samples: ["``x``"] }]), "- 検体: ``` ``x`` ```");
  assert.equal(formatPiiReport([{ id: "x", label: "検体", samples: ["`"] }]), "- 検体: `` ` ``");
});

test("検体の改行は箇条書きを壊さないようまとめる", () => {
  const report = formatPiiReport([{ id: "phone", label: "電話番号らしき数字", samples: ["090\n1234 5678"] }]);
  assert.equal(report, "- 電話番号らしき数字: `090 1234 5678`");
  assert.equal(report.split("\n").length, 1);
});

test("見出しごとに本文を分解する", () => {
  const sections = parseSections("### 質問\nこまっています\n\n### カテゴリ\nプライバシーについて");
  assert.equal(sections.get("質問"), "こまっています");
  assert.equal(sections.get("カテゴリ"), "プライバシーについて");
});

test("運営の最新の回答コメントを採用する", () => {
  const { entry, problems } = parseIssue(
    issue(),
    [comment("社内メモ"), comment("### 回答\n古い回答"), comment("### 回答\n新しい回答")],
    config,
  );
  assert.deepEqual(problems, []);
  assert.equal(entry.answer, "新しい回答");
  assert.equal(entry.question, "GitHubアカウントは必要ですか？");
  assert.equal(entry.category, "site");
});

test("回答コメントがないときは本文の回答セクションを使う", () => {
  const sections = parseSections("### 質問\n本文\n\n### 回答\n本文に書いた回答");
  assert.deepEqual(pickAnswer([], sections), { text: "本文に書いた回答", source: "body" });
  assert.equal(pickAnswer([comment("### 回答\nコメントの回答")], sections).text, "コメントの回答");
});

test("回答コメントがなければ公開しない", () => {
  const { entry, problems } = parseIssue(issue(), [comment("あとで書きます")], config);
  assert.equal(entry, null);
  assert.match(problems.join(), /回答が見つかりません/);
});

test("書き込み権限のない投稿者の回答は採用しない", () => {
  const { entry, problems } = parseIssue(issue(), [comment("### 回答\nなりすまし", "NONE")], config);
  assert.equal(entry, null);
  assert.match(problems.join(), /書き込み権限がありません/);
});

test("公開用の質問セクションがタイトルより優先される", () => {
  const target = issue({ body: "### 公開用の質問\n言い換えた質問\n\n### 質問\n元の質問" });
  const { entry } = parseIssue(target, [comment("### 回答\n回答")], config);
  assert.equal(entry.question, "言い換えた質問");
});

test("カテゴリはラベルを本文より優先する", () => {
  const target = issue({ labels: [{ name: "公開" }, { name: "cat:privacy" }] });
  assert.equal(pickCategory(target, parseSections(target.body), config), "privacy");
});

test("カテゴリが判別できないときは既定値になる", () => {
  const target = issue({ body: "### 質問\n本文だけ", labels: [] });
  assert.equal(pickCategory(target, parseSections(target.body), config), "ask");
});
