---
name: claude-usage-review
description: ローカルのClaude Codeログと、ログに登場したプロジェクトおよびグローバル設定の現在のCLAUDE.mdやSkillを分析し、ユーザーのClaude Codeの使い方を改善する。過去の依頼を振り返りたい、非効率だったセッションの原因を知りたい、CLAUDE.mdやSKILLSを効果的に使えているか確認したい場合に使用する。
---

# Claude Usage Review

このSkillは、ユーザー個人のClaude Code利用状況を振り返り、ログ上の根拠に基づいた改善レポートを作成するために使用する。

このSkillは、以下の2種類の入力を明確に分けて扱う。

- Prompt Episodeとして要約された過去のClaude Codeログ
- ログに登場したプロジェクトに現在存在する`CLAUDE.md`やプロジェクトSkillなどのプロジェクト資産
- Claude Codeのグローバル設定ディレクトリに現在存在する`CLAUDE.md`やSkillなどのグローバル資産

現在の`CLAUDE.md`やSkillファイルが、過去セッション時点でも同じ内容で存在していたとは扱わない。これらは現在のプロジェクト資産またはグローバル資産としてのみ分析する。

## ワークフロー

1. Skillを実行したカレントディレクトリに`reports/`を作成する。
2. このSkillディレクトリ内の収集スクリプトを実行し、JSONをカレントディレクトリの`reports/`配下に出力する。
3. 生成されたJSONを読み込む。**このとき、統計情報（集計クエリや要約スクリプトの結果）だけに基づいて判断してはならない。`log_analysis.episodes`の全エピソードについて、1件ずつその内容を確認する。各エピソードのユーザープロンプト、ツール使用状況、検証状態、アシスタント応答を全て精読した上でレポートを作成する。JSON全体を一度に読み込んでもよいが、その場合は読み終えた後に「このエピソードでは〜」と個別の事実を具体的に挙げられる状態になっていること。**
4. ユーザーのClaude Codeの使い方改善に焦点を当てたMarkdownレポートを、同じ`reports/`配下に作成する。

出力先は、Skillを呼び出したプロジェクトのカレントディレクトリを基準にする。JSONとレポートは同じ`reports/`ディレクトリに保存する。

推奨される出力ファイル名:

- `reports/claude-usage-review-input-YYYY-MM-DD.json`
- `reports/claude-usage-review-YYYY-MM-DD.md`

収集スクリプトのパスは、Skillのインストール形態によって異なる。以下の優先順で実在するディレクトリを`<SKILL_DIR>`として扱う。

1. プロジェクトにインストールされている場合: `.claude/skills/claude-usage-review`
2. グローバルにインストールされている場合: `~/.claude/skills/claude-usage-review`
3. このリポジトリ内で直接テストする場合: `skills/claude-usage-review`

デフォルトの実行コマンド:

```bash
npx --yes tsx <SKILL_DIR>/scripts/collect.ts --days 7 --out reports/claude-usage-review-input-YYYY-MM-DD.json
```

利用可能なClaude Codeログを全期間対象にする場合:

```bash
npx --yes tsx <SKILL_DIR>/scripts/collect.ts --all --out reports/claude-usage-review-input-YYYY-MM-DD.json
```

任意のフィルタ例:

```bash
npx --yes tsx <SKILL_DIR>/scripts/collect.ts --days 30 --project Agents-FB --out reports/claude-usage-review-input-YYYY-MM-DD.json
```

プロジェクトに`npx skills add ... -a claude-code`でインストールされている場合の具体例:

```bash
npx --yes tsx .claude/skills/claude-usage-review/scripts/collect.ts --days 7 --out reports/claude-usage-review-input-YYYY-MM-DD.json
```

実行時は`YYYY-MM-DD`を当日の日付に置き換える。

`reports/`が存在しない場合は、コマンド実行前にカレントディレクトリ直下へ作成する。

生成されるJSONにはredact済みであっても個人のClaude Code利用状況が含まれるため、不要にコミットしない。

## レポート要件

レポートの構成、トーン、各セクションの内容は、[report-format.md](report-format.md)に従う。

レポート作成前に必ず`report-format.md`を読み、そこに定義された形式でMarkdownレポートを作成する。

## JSONの読み込み方法

JSONは以下の手順で全データを漏れなく読み込む。

1. `meta` セクションを読み、収集条件と統計情報を把握する。
2. `log_analysis.episodes` の全エピソードを、**個別にReadで1件ずつ**読み込む。各エピソードについて以下を確認する:
   - `user_prompt.excerpt` または `user_prompt.normalized_excerpt`（ユーザーの実際の依頼文）
   - `user_prompt.prompt_intent` と `deliverable_type`（依頼の種類と成果物）
   - `user_prompt.*` の各フラグ（`has_task_goal`、`expected_result_strength`、`has_scope_limit` など）
   - `after_behavior.tool_call_count`、`tool_counts`、`tool_categories`（ツール使用状況）
   - `after_behavior.bash_commands`、`repeated_bash_commands`（実行したコマンドの実体）
   - `after_behavior.verification_status`、`had_verification_command`（検証状態）
   - `after_behavior.files_read`、`files_edited`（読み書きしたファイル）
   - `outcome.assistant_final_excerpt`（アシスタントの応答）
   - `outcome.next_user_prompt_type`（次のユーザー反応）
   - `outcome.ended_with_api_error`、`ended_with_user_abort`（セッション終了理由）
3. `project_assets.projects` の全プロジェクトを読み、CLAUDE.mdやSkillの現在の状態を把握する。
4. `global_assets.assets` を読み、グローバル設定の現在の状態を把握する。

全エピソードを読み終えた後に、初めてレポートの構成と内容を決定する。統計スクリプト（node -e 等）による集計値の取得は、個別確認の補助としてのみ使用し、集計値だけでレポートを書いてはならない。

## 分析ルール

- 指摘はJSON上の根拠に基づける。
- 引用はredact済みの短い抜粋だけにする。
- 長いコードブロックや巨大なtool outputは引用しない。
- 過去ログ上の挙動と現在のプロジェクト資産の間に、直接の因果関係を推定しない。
- 根拠が弱い場合は断定しない。
- 断定的な評価よりも、「この傾向が見える」「可能性がある」のような慎重な表現を優先する。
- 主要な指摘は、必ず具体的な次の行動に変換する。

## 重要な区別

`log_analysis.episodes`は、過去のClaude Codeセッションから抽出された情報を表す。

`project_assets.projects`は、ログに登場したプロジェクトフォルダに現在存在するファイルから抽出された情報を表す。

`global_assets.assets`は、Claude Codeのグローバル設定ディレクトリに現在存在するファイルから抽出された情報を表す。

`CLAUDE.md`やSkillについて述べる場合は、その分析が現在のファイル状態に基づくものであり、それらが過去セッションに影響した証拠ではないことを明示する。
