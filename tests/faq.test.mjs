import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown, escapeHtml } from "../scripts/lib/markdown.mjs";
import { scanPii, formatPiiReport } from "../scripts/lib/pii.mjs";
import { parseIssue, parseSections, pickAnswer, pickCategory } from "../scripts/lib/parse-issue.mjs";
import { assertLabelNames, missingRequiredLabels } from "../scripts/lib/labels.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";

const config = {
  labels: { publish: "公開", review: "要確認", reviewed: "レビュー済", piiReviewed: "PII確認済" },
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

test("コードブロックを pre/code にする", () => {
  assert.equal(
    renderMarkdown("手順です。\n\n```bash\nnpm install\n```"),
    '<p>手順です。</p><pre><code class="language-bash">npm install</code></pre>',
  );
  assert.equal(renderMarkdown("```\nplain\n```"), "<pre><code>plain</code></pre>");
});

test("コードブロックは空行を含んでも1つのまとまりになる", () => {
  assert.equal(
    renderMarkdown("```js\nconst a = 1;\n\nconsole.log(a);\n```"),
    '<pre><code class="language-js">const a = 1;\n\nconsole.log(a);</code></pre>',
  );
});

test("前後に空行がなくてもコードブロックを段落から分離する", () => {
  assert.equal(
    renderMarkdown("説明します。\n```sh\nls -la\n```\n続きです。"),
    '<p>説明します。</p><pre><code class="language-sh">ls -la</code></pre><p>続きです。</p>',
  );
});

test("コードブロックの中身はHTMLもMarkdownも解釈しない", () => {
  const html = renderMarkdown("```\n<script>alert(1)</script>\n**太字**にならない\n[表示](https://example.com)\n```");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<strong>"));
  assert.ok(!html.includes("<a "));
  assert.ok(html.includes("**太字**にならない"));
});

test("コードブロックを閉じ忘れても壊れない", () => {
  assert.equal(renderMarkdown("```bash\nnpm test"), '<pre><code class="language-bash">npm test</code></pre>');
});

test("言語名に使えない文字は言語指定として扱わない", () => {
  const html = renderMarkdown('```js"onload="x\ncode\n```');
  assert.ok(!html.includes("language-"), "不正な言語名がクラスに入っています: " + html);
});

const withLabels = (...names) => ({ labels: names.map((name) => ({ name })) });

test("3つのラベルが揃ったときだけ公開の対象にする", () => {
  assert.deepEqual(missingRequiredLabels(withLabels("公開", "レビュー済", "PII確認済"), config), []);
});

test("ラベルが欠けていれば不足分を返す", () => {
  assert.deepEqual(missingRequiredLabels(withLabels("公開"), config), ["レビュー済", "PII確認済"]);
  assert.deepEqual(missingRequiredLabels(withLabels("公開", "レビュー済"), config), ["PII確認済"]);
  assert.deepEqual(missingRequiredLabels(withLabels("レビュー済", "PII確認済"), config), ["公開"]);
});

test("ラベルが文字列の配列で来ても判定できる", () => {
  assert.deepEqual(missingRequiredLabels({ labels: ["公開", "レビュー済", "PII確認済"] }, config), []);
  assert.deepEqual(missingRequiredLabels({ labels: ["公開", "PII確認済"] }, config), ["レビュー済"]);
});

test("文字列とオブジェクトが混ざっていても判定できる", () => {
  const mixed = { labels: ["公開", { name: "レビュー済" }, "PII確認済"] };
  assert.deepEqual(missingRequiredLabels(mixed, config), []);
});

// 設定の検証は2段階に分かれている。
//   loadConfig()（assertLabelNames）… 設定ファイルの入口。差し戻し用の review も含めて全キーを確認する
//   missingRequiredLabels          … Issueごとの判定。公開に必要な3キーだけを前提にする
const withoutReview = { labels: { publish: "公開", reviewed: "レビュー済", piiReviewed: "PII確認済" } };

test("設定の入口検証は、差し戻し用の review も含めて全キーを確認する", () => {
  assert.throws(() => assertLabelNames(withoutReview), /labels\.review が未設定/);
  assert.throws(() => assertLabelNames({ labels: {} }), /labels\.publish が未設定/);
  assert.doesNotThrow(() => assertLabelNames(config));
});

test("実際の config/site.json が入口検証を通る", () => {
  assert.doesNotThrow(() => loadConfig());
});

test("Issueの判定は、公開に必要な3キーだけを前提にする", () => {
  // review は判定に使わないので、欠けていても判定は動く
  assert.deepEqual(missingRequiredLabels({ labels: ["公開", "レビュー済", "PII確認済"] }, withoutReview), []);

  // 判定に必要なキーが欠けていれば、どれが足りないかを示して止める
  const noPii = { labels: { publish: "公開", review: "要確認", reviewed: "レビュー済" } };
  assert.throws(() => missingRequiredLabels({ labels: [] }, noPii), /labels\.piiReviewed が未設定/);
});

test("ラベルの形が想定外でも例外にせず無視する", () => {
  const broken = { labels: [null, undefined, { name: undefined }, { name: "" }, "公開", { name: "レビュー済" }] };
  assert.deepEqual(missingRequiredLabels(broken, config), ["PII確認済"]);
  assert.deepEqual(missingRequiredLabels({}, config), ["公開", "レビュー済", "PII確認済"]);
});

test("関係ないラベルが付いていても判定は変わらない", () => {
  assert.deepEqual(
    missingRequiredLabels(withLabels("公開", "レビュー済", "PII確認済", "cat:privacy", "要確認"), config),
    [],
  );
  assert.deepEqual(missingRequiredLabels({ labels: [] }, config), ["公開", "レビュー済", "PII確認済"]);
});

test("取り消し線を del にする", () => {
  assert.equal(renderMarkdown("~~旧手順~~ は廃止"), "<p><del>旧手順</del> は廃止</p>");
  assert.ok(!renderMarkdown("`~~記号のまま~~`").includes("<del>"));
  assert.ok(!renderMarkdown("```\n~~記号のまま~~\n```").includes("<del>"));
});

test("チェックリストを操作できないチェックボックスにする", () => {
  assert.equal(
    renderMarkdown("- [ ] 未完了\n- [x] 完了"),
    '<ul class="task-list">' +
      '<li class="task"><input type="checkbox" disabled><span>未完了</span></li>' +
      '<li class="task"><input type="checkbox" disabled checked><span>完了</span></li>' +
      "</ul>",
  );
  assert.ok(renderMarkdown("- [X] 大文字").includes("checked"));
});

test("チェックリストと通常の項目が混ざっても両方出す", () => {
  const html = renderMarkdown("- [ ] タスク\n- ふつうの項目");
  assert.ok(html.includes('<li class="task">'));
  assert.ok(html.includes("<li>ふつうの項目</li>"));
});

test("リンクのURLに含まれる記号を強調として書き換えない", () => {
  assert.equal(
    renderMarkdown("[資料](https://example.com/x**y**z)"),
    '<p><a href="https://example.com/x**y**z" target="_blank" rel="noopener">資料</a></p>',
  );
  assert.ok(!renderMarkdown("[資料](https://example.com/a~~b~~c)").includes("<del>"));
});

test("リンクのラベルには強調が効く", () => {
  assert.ok(renderMarkdown("[**重要**な資料](https://example.com)").includes("<strong>重要</strong>"));
});

test("番号付きリストを ol にする", () => {
  assert.equal(
    renderMarkdown("1. 作成する\n2. 実行する"),
    "<ol><li>作成する</li><li>実行する</li></ol>",
  );
  assert.equal(renderMarkdown("1) 一つ目\n2) 二つ目"), "<ol><li>一つ目</li><li>二つ目</li></ol>");
});

test("1以外から始まる番号付きリストは開始番号を保つ", () => {
  assert.equal(renderMarkdown("3. 三番目\n4. 四番目"), '<ol start="3"><li>三番目</li><li>四番目</li></ol>');
});

test("引用を blockquote にする", () => {
  assert.equal(
    renderMarkdown("> 前日まで受け付けます。\n> 定員で締め切ります。"),
    "<blockquote><p>前日まで受け付けます。<br>定員で締め切ります。</p></blockquote>",
  );
});

test("リストと引用の中でも太字・リンク・コードが効く", () => {
  assert.ok(renderMarkdown("> **重要**です").includes("<strong>重要</strong>"));
  assert.ok(renderMarkdown("1. `npm ci` を実行").includes("<code>npm ci</code>"));
  assert.ok(renderMarkdown("1. [資料](https://example.com)").includes('<a href="https://example.com"'));
});

test("リスト記号で始まらない行が混ざる場合は段落のままにする", () => {
  assert.equal(renderMarkdown("手順:\n1. 一つ目"), "<p>手順:<br>1. 一つ目</p>");
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
