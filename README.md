# CWBJ FAQ

Code;Without Barriers in Japan（CWBJ）のFAQ公開ページと、質問の受付から公開までの運用フローです。

**Q&Aの中身はHTMLに直接書きません。** `data/faq.json` を `index.html` が読み込んで表示します。
質問が増えても増えるのはJSONだけで、HTMLは変わりません。

## ファイル構成

| パス | 役割 | 編集する人 |
| --- | --- | --- |
| `index.html` | FAQページ。データを読み込んで描画する（検索・カテゴリ絞り込み・開閉） | 見た目を変えるときだけ手で編集 |
| `flow.html` | 質問受付から公開までの運用フロー・システム構成 | 手で編集 |
| `data/curated.json` | 運営が常設で載せるQ&A | **手で編集** |
| `data/intake.json` | Formsから届いた質問と回答 | 自動生成（触らない） |
| `data/faq.json` | 上2つを合成した表示用データ | 自動生成（触らない） |
| `config/site.json` | カテゴリ一覧・FormsのURL・intakeリポジトリ名 | **手で編集** |
| `scripts/` | データを組み立てるスクリプト | |
| `docs/intake-setup.md` | intakeリポジトリ（private）の設定と運用手順 | |
| `.nojekyll` | GitHub PagesでJekyll処理を行わせないための空ファイル | |

## データの流れ

```text
Microsoft Forms
   ↓ Power Automate（自動）
intakeリポジトリ（private）のIssue      ← 運営が回答・個人情報チェック・「公開」ラベル
   ↓ GitHub Actions（自動・collect-issues.mjs）
data/intake.json  ＋  data/curated.json（手編集）
   ↓ build-data.mjs
data/faq.json
   ↓ fetch
index.html（GitHub Pages）
```

個人情報を含む生データはprivateリポジトリに留まり、公開リポジトリへ渡るのは確認を通ったQ&Aだけです。
詳細は [`flow.html`](flow.html) と [`docs/intake-setup.md`](docs/intake-setup.md) を参照してください。

## 常設のQ&Aを追加・修正する

1. `data/curated.json` の `entries` に追記する

   ```json
   {
     "id": "c8",
     "category": "site",
     "question": "掲載されたQ&Aはいつ更新されますか？",
     "answer": "運営で内容を確認したタイミングで更新しています。**太字**、箇条書き、[リンク](https://example.com)が使えます。",
     "updatedAt": "2026-08-13T00:00:00Z"
   }
   ```

   - `id` は他と重複しない文字列（常設分は `c1`, `c2`… の連番）
   - `category` は `config/site.json` の `categories` にあるID
   - `answer` はMarkdown（段落・各種リスト・引用・太字・取り消し線・`コード`・``` のコードブロック・httpsリンク。画像と表は非対応）
2. `node scripts/build-data.mjs` を実行して `data/faq.json` を作り直す
3. `data/curated.json` と `data/faq.json` をコミットする

`data/faq.json` を作り直さずにpushした場合も、GitHub Actions（`.github/workflows/build-data.yml`）が
生成し直してコミットします。

## カテゴリ・フォームURLを変える

`config/site.json` を編集して `node scripts/build-data.mjs` を実行します。

- `categories` … 表示順もこの並び順のとおり
- `formsUrl` … `https://` で始まるURLを入れると「質問・相談を送る」ボタンが有効になる（`#` のままだと無効表示）
- `intakeRepo` … Issueを読みに行くprivateリポジトリ

## ローカルで確認する

`index.html` を直接ブラウザで開くと、`data/faq.json` の読み込みがブラウザ側の制限（file://）で
ブロックされます。簡易サーバー経由で開いてください。

```bash
node scripts/build-data.mjs   # データを組み立てる
npx serve .                   # または python -m http.server
```

テストは `node --test "tests/*.test.mjs"`（Node 20以上）。個人情報チェック・Markdown変換・Issue解析を確認します。

## GitHub Pagesで公開する

リポジトリ設定の Pages を次のようにします。

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**

公開URL（リポジトリ名が `cwbj` の場合）:

```text
https://<GitHubユーザー名>.github.io/cwbj/
https://<GitHubユーザー名>.github.io/cwbj/flow.html
```

## 補足

- `index.html` の「質問・相談を送る」リンクは、`config/site.json` の `formsUrl` が `#` のあいだは無効表示のままです。運用開始時にMicrosoft FormsのURLへ差し替えてください。
- Q&Aの回答はビルド時にエスケープしてからHTMLへ変換しています。フォームから届いた文章がそのままHTMLとして解釈されることはありません。
