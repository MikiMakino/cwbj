// intakeリポジトリのIssueを、公開用のQ&Aに変換する。
// Issue本文はPower AutomateがFormsの回答から組み立てる（docs/intake-setup.md 参照）。

const ANSWER_HEADING = /^#{2,4}\s*回答\s*$/;
const SECTION_HEADING = /^#{2,4}\s+(.+?)\s*$/;

/** `### 見出し` で区切られた本文を、見出し名 -> 本文 のMapにする。 */
export function parseSections(body) {
  const sections = new Map();
  let current = null;
  let buffer = [];

  const flush = () => {
    if (current !== null) sections.set(current, buffer.join("\n").trim());
    buffer = [];
  };

  for (const line of String(body || "").replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      flush();
      current = heading[1].trim();
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function toSingleLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isMaintainer(comment) {
  return ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.author_association);
}

/** 運営が書いた最新の「### 回答」コメントを採用する。本文中の回答セクションは代替手段。 */
export function pickAnswer(comments, sections) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    const lines = String(comment.body || "").replace(/\r\n?/g, "\n").split("\n");
    const firstIndex = lines.findIndex((line) => line.trim() !== "");
    if (firstIndex === -1) continue;
    if (!ANSWER_HEADING.test(lines[firstIndex].trim())) continue;

    if (!isMaintainer(comment)) {
      return { text: "", error: `回答コメント（#${comment.id}）の投稿者に書き込み権限がありません` };
    }
    return { text: lines.slice(firstIndex + 1).join("\n").trim(), source: `comment:${comment.id}` };
  }

  if (sections.has("回答")) {
    return { text: sections.get("回答"), source: "body" };
  }
  return { text: "", error: "回答が見つかりません（運営の「### 回答」コメントが必要です）" };
}

export function pickCategory(issue, sections, config) {
  const labelNames = (issue.labels || []).map((label) => (typeof label === "string" ? label : label.name));

  for (const category of config.categories) {
    if (labelNames.includes(`cat:${category.id}`) || labelNames.includes(category.label)) {
      return category.id;
    }
  }

  const fromBody = toSingleLine(sections.get("カテゴリ") || "");
  if (fromBody) {
    const matched = config.categories.find((c) => c.label === fromBody || c.id === fromBody);
    if (matched) return matched.id;
  }
  return config.defaultCategory;
}

export function pickQuestion(issue, sections) {
  const override = toSingleLine(sections.get("公開用の質問") || "");
  if (override) return override;

  const title = toSingleLine(issue.title);
  if (title) return title;

  const raw = toSingleLine((sections.get("質問") || "").split("\n")[0]);
  return raw;
}

/**
 * @returns {{entry: object|null, problems: string[]}}
 *   entry が null のときは公開せず、problems を運営に知らせる。
 */
export function parseIssue(issue, comments, config) {
  const sections = parseSections(issue.body);
  const problems = [];

  const question = pickQuestion(issue, sections);
  if (!question) problems.push("公開用の質問文が空です（Issueタイトルか「### 公開用の質問」を設定してください）");

  const answer = pickAnswer(comments, sections);
  if (answer.error) problems.push(answer.error);

  if (problems.length > 0) return { entry: null, problems };

  return {
    entry: {
      id: issue.number,
      category: pickCategory(issue, sections, config),
      question,
      answer: answer.text,
      answerSource: answer.source,
      updatedAt: issue.updated_at,
    },
    problems,
  };
}
