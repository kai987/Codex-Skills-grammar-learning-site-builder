# Multilingual Grammar Learning Site Builder

[![CI](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/ci.yml)

[English](README.md) | 日本語

検証済みの `grammar-report.json` から、文と文法を対話的に学べる静的 Web サイトを生成する Codex スキルのコアランタイムです。
React・TypeScript・Vite を使用し、元の語法・文法レポートを変更せずに学習画面を構築します。

## 公開コードとプレビュー

実行コードとスキルはこのリポジトリに含まれています。以下の手順では既定の `main` ブランチを取得します。
ホスト済みのデモサイトは現在案内していません。生成結果はローカルの HTTP サーバーや任意の静的ホスティングで表示できます。

## 主な機能

- 元の文と文法項目を検索し、文ごとの解説・読み・訳・例文・語彙を確認できます。
- 内容の言語や、JLPT・HSK・CEFR などのレベル体系で絞り込めます。
- 中国語・日本語・英語の UI を切り替えられます。レポート内の原文や解説言語は UI 切り替えで書き換えません。
- 閲覧位置やフィルターを URL に反映し、同じ学習状態を開けます。
- レスポンシブな画面と、ライト・ダーク・システム連動のテーマに対応します。
- 時刻情報のある文ではタイムラインを利用できます。ローカル動画は明示的に指定した場合だけコピーします。
- 入力レポートを検証し、生成先へバイト単位でそのままコピーします。

## 読みやすさと操作性

- 文法項目のない文は画面から除外し、表示件数・ナビゲーション・タイムラインを更新します。入力 JSON 自体は変更しません。
- デスクトップでは原文と解説を二列で表示し、訳は原文の直後、読みは必要に応じて展開します。
- 文番号での移動と左右矢印キーでの文切り替えに対応します。文番号で移動すると絞り込みは解除されます。入力欄のカーソル操作は妨げません。
- 長いタイムラインは折りたたんで表示します。スマートフォンでは下部ナビゲーションと「原文に戻る」操作を利用できます。

## このツールが行わないこと

文法分析や字幕の生成・修正を行うツールではありません。先に用意したレポートを Web サイトとして表示する役割に限定しています。
不足する読み・翻訳・例文・文法解説を新しく生成することもありません。

入力には、対応するスキーマに適合した `grammar-report.json` が必要です。
Markdown 版レポートは必須ではなく、生の字幕や文章を JSON の代わりに渡すことはできません。

## 継続的インテグレーション

[GitHub Actions CI](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/ci.yml) は、すべての push とプルリクエストで自動実行され、手動で開始することもできます。
Ubuntu・Node.js 24・npm 11.18.0 の環境で、`npm ci` の後に `typecheck`・`build`・`test`・`format:check` を独立したジョブで実行します。
一つのチェックが失敗しても、ほかのチェックは継続します。

五つ目の `generated-files` は依存関係をインストールせず、Node.js で Git のコミットツリー全体を検査します。
任意の階層にある `output/`、キャッシュ、ビルド・カバレッジの成果物、依存関係のディレクトリに加え、ビルドメタデータ・ログ、アーカイブ、メディア出力、既知の生成レポートを検出すると失敗します。
ソースのアセット、スキーマ、`tests/fixtures/` 内の合成レポート用フィクスチャは許可されます。
ローカルで生成されただけの、未追跡・無視対象のファイルは検査対象ではありません。

## コントリビューション

`main` は保護されています。変更は必ずプルリクエスト（PR）で提出してください。
管理者を含め、`main` への直接 push はできません。

1. ローカルのクローンで最新の `main` から作業ブランチを作成します。

   ```bash
   git switch main
   git pull --ff-only origin main
   git switch -c codex/your-change
   ```

2. 変更後、Node.js 24・npm 11.18.0 で CI と同じチェックを実行します。

   ```bash
   npm ci
   npm run typecheck
   npm run build
   npm test
   npm run format:check
   ```

   フォーマットの修正が必要な場合は `npm run format` を実行し、差分を確認してから `npm run format:check` を再実行します。
   生成済みの `output/`、レポート、動画、ビルド成果物、キャッシュ、`node_modules/` はコミットに含めないでください。

3. 対象のファイルをコミットした後、`npm run check:generated-files` でそのコミットを検査してから作業ブランチを push します。
   `main` をマージ先とする PR を作成します。
   PR には変更内容と実行したチェックを記載してください。

4. GitHub Actions の必須チェック `typecheck`・`build`・`test`・`format:check`・`generated-files` の五つすべてが成功するのを待ちます。
   一つでも実行待ち・実行中・失敗の状態であればマージできません。
   また、PR のブランチは最新の `main` に追従している必要があります。
   `main` が更新された場合は作業ブランチに反映し、CI が再びすべて成功してからマージしてください。

## 動作環境

- Node.js 24
- npm 11 以上（リポジトリの指定は npm 11.18.0）
- 下記のプレビュー例を使う場合のみ Python 3

生成されるサイトにブラウザー側の API キーは不要です。

## セットアップ

```bash
git clone \
  https://github.com/kai987/Codex-Skills-grammar-learning-site-builder.git
cd Codex-Skills-grammar-learning-site-builder

npm ci
npm run typecheck
npm run build
npm test
```

すでにクローン済みの場合は、未コミットの変更を保護したうえで、`main` を更新してから実行してください。

## 学習サイトを生成する

リポジトリのルートで、同梱のスキル実行スクリプトを呼び出します。

```bash
node .agents/skills/multilingual-grammar-learning-site-builder/scripts/run.mjs \
  --input "/path/to/grammar-report.json" \
  --output output/sample
```

専用 CLI から実行することもできます。

```bash
npm run build-learning-site -- \
  --input "/path/to/grammar-report.json" \
  --output output/sample
```

`/path/to/grammar-report.json` は、実際のレポートのパスに置き換えてください。

| オプション     | 用途                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| `--input`      | 入力するレポート JSON のパス。必須です。                                                      |
| `--output`     | 出力先の親ディレクトリ。指定先の `site/` に Web サイトを生成します。                          |
| `--overwrite`  | すでに存在する、指定出力先の `site/` を置き換えます。必要なファイルを事前に退避してください。 |
| `--copy-video` | 指定したローカル動画をサイトへコピーします。省略時は動画をコピーしません。                    |

## 生成結果を開く

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory output/sample/site
```

ブラウザーで [http://127.0.0.1:4173/](http://127.0.0.1:4173/) を開きます。
JSON を HTTP で読み込むため、`index.html` のダブルクリックではなく HTTP サーバー経由で閲覧してください。
サーバーはターミナルで `Ctrl+C` を押すと停止できます。

出力先には以下が含まれます。

```text
output/sample/site/
├── index.html
├── assets/                  # ビルド済みのローカルアセット
├── data/
│   ├── grammar-report.json  # 入力レポートの変更なしコピー
│   └── build-manifest.json  # ビルド情報とレポートの SHA-256
└── README.txt
```

任意の静的ホスティングへ配置する場合は、生成された `site/` 全体を配置してください。
レポートの原文・解説、明示的にコピーした動画は配信先から閲覧できるため、公開前に内容と共有範囲を確認してください。

## リポジトリの収録範囲

このリポジトリには、サイト生成に必要なコアコードと関連テストのみを収録しています。

- `.agents/skills/multilingual-grammar-learning-site-builder` — スキルの指示、契約、実行スクリプト
- `apps/grammar-learning-site-template` — React / Vite の学習画面
- `packages/site-builder-core` — 静的サイトのビルド処理
- `packages/shared` — 対応レポートの型・検証、ファイル操作の共通処理
- `schemas/grammar-report.schema.json` — 入力レポートの JSON Schema
- `scripts/build-learning-site.ts` — 専用 CLI
- `tests/integration` — ビルド処理の統合テスト

生成済みの `output/`、分析レポート、動画、キャッシュ、ベンチマーク、仮想環境、字幕生成・文字起こしパイプライン、無関係なスキルは収録対象外です。

## ライセンス

このリポジトリのコードは [MIT License](LICENSE) で公開されています。
入力する文章・字幕・動画の利用条件は、それぞれの権利者の定める条件に従ってください。
