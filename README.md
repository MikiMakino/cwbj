# CWBJ FAQ

Code;Without Barriers in Japan（CWBJ）のFAQ公開イメージと、運用フローをまとめたGitHub Pages用のサンプルです。

## ページ構成

- `index.html` — FAQページのモックアップ
  - キーワード検索
  - カテゴリ絞り込み
  - Q&Aの開閉表示
- `flow.html` — 質問受付から公開までの運用フロー・システム構成
- `.nojekyll` — GitHub PagesでJekyll処理を行わず、そのまま静的ファイルを配信するための空ファイル

## 想定している運用

1. 質問者が Microsoft Forms から質問・相談を送信
2. Power Automate が private な intake リポジトリに GitHub Issue を自動起票
3. 運営が回答を作成し、個人情報を確認・編集
4. 公開可能な Issue に「公開」ラベルを付与
5. GitHub Actions が匿名化済みのQ&Aのみを公開用リポジトリ／GitHub Pagesへ反映

詳細は `flow.html` を参照してください。

## GitHub Pagesで公開する

GitHub のリポジトリ設定で、Pages の公開元を次のように設定します。

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**

リポジトリ名が `cwbj` の場合、公開URLは通常次の形式になります。

```text
https://<GitHubユーザー名>.github.io/cwbj/
```

運用フローは次のURLです。

```text
https://<GitHubユーザー名>.github.io/cwbj/flow.html
```

## ローカルからpushする例

GitHub側で空の `cwbj` リポジトリを作成したあと、このディレクトリで実行します。

```bash
git init
git add .
git commit -m "Add CWBJ FAQ mockup and flow"
git branch -M main
git remote add origin https://github.com/<GitHubユーザー名>/cwbj.git
git push -u origin main
```

すでにローカルリポジトリとして初期化済みの場合は、`git init` や `git remote add origin` は不要です。

## 補足

`index.html` の「質問・相談を送る」リンクは現在モック用の `#` です。実運用時に Microsoft Forms のURLへ置き換えてください。
