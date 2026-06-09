# opencode Usage Review レポート形式

このドキュメントは、`opencode-usage-review` Skillが生成するMarkdownレポートの形式を定義する。

レポートは、責任追及や点数付けではなく、次回から実行できる改善に焦点を当てる。

## 基本方針

- ログ上の根拠に基づいて書く。
- 短い引用や観測事実を含める。
- 秘密情報、長いコード断片、巨大なtool outputは引用しない。
- 過去ログ由来の分析と、現在のプロジェクト資産およびグローバル資産の分析を明確に分ける。
- 現在の`opencode.json`、`CLAUDE.md`、`AGENTS.md`、Skill、Agent、Commandが過去セッションに影響したとは断定しない。
- 各指摘は、次回から試せる具体的な行動に変換する。
- **統計情報だけで分析を終えず、必ず全エピソードを個別に読み、個々の事実や引用に基づいて記述する。**

## 保存先

レポートは、Skillを実行したカレントディレクトリの`reports/`配下に保存する。

収集スクリプトが生成したJSONも、同じ`reports/`配下に保存する。

推奨ファイル名:

- 収集JSON: `reports/opencode-usage-review-input-YYYY-MM-DD.json`
- Markdownレポート: `reports/opencode-usage-review-YYYY-MM-DD.md`

`YYYY-MM-DD`は実行日の日付に置き換える。

生成されるJSONとレポートには、redact済みであっても個人のopencode利用状況が含まれるため、不要にコミットしない。

## 必須セクション

レポートには以下のセクションをこの順序で含める。

1. 対象期間と分析対象
2. 全体サマリー
3. ログから見えたopencodeへの依頼の出し方
4. 効率よく進んだPrompt Episodeの特徴
5. 非効率になったPrompt Episodeの特徴
6. デバッグ依頼の改善点
7. 実装・リファクタ依頼の改善点
8. 現在のopencode設定整備状況
9. 現在のCLAUDE.md/AGENTS.md整備状況
10. 現在のSKILLS整備状況
11. 現在のAgent/Command整備状況
12. 次回から使うプロンプトテンプレート
13. 次の1週間で試す運用改善

## 各セクションの内容

### 1. 対象期間と分析対象

以下を簡潔に記載する。

- 収集対象期間
- スキャンしたSQLite DB数とセッション数
- 抽出したPrompt Episode数
- Project Assetsとして分析したプロジェクト数
- parse errorやunknown eventなど、分析の信頼性に関わるメタ情報

### 2. 全体サマリー

ユーザーのopencode利用について、重要な傾向を3から5点で要約する。

良い点と改善余地の両方を含める。

### 3. ログから見えたopencodeへの依頼の出し方

Prompt Episodeから、依頼文の特徴を分析する。

見る観点:

- 初回依頼の具体性
- ファイル名や対象範囲の明示
- 達成したい作業内容の有無
- 期待結果、完了条件、受け入れ条件の明示度
- 検証コマンドの明示
- 出力形式、スコープ制約、再現手順、直近変更文脈の有無
- 短文承認の使い方

### 4. 効率よく進んだPrompt Episodeの特徴

tool call数、toolカテゴリ、失敗の少なさ、検証状態、次のユーザー反応などから、効率よく進んだ例を挙げる。

短い引用と観測事実をセットで示す。

### 5. 非効率になったPrompt Episodeの特徴

探索過多、Bash失敗、同一コマンドの繰り返し、検証失敗または未検証、次ターンでの修正要求などを根拠に分析する。

ただし、ユーザーのプロンプトだけを原因として断定しない。

### 6. デバッグ依頼の改善点

デバッグ依頼で不足しがちな情報を整理する。

見る観点:

- エラーログ
- 再現手順
- 期待結果
- 直近で変更した内容
- 実行済みの検証コマンド

### 7. 実装・リファクタ依頼の改善点

実装やリファクタ依頼で、スコープや完了条件が明確だったかを分析する。

見る観点:

- 対象ファイルや対象機能
- やること、やらないこと
- 既存仕様の扱い
- テストやlintの期待
- セッション分割が必要そうな大きな依頼

### 8. 現在のopencode設定整備状況

`project_assets.projects[].configs`と`global_assets.assets.configs`をもとに、ログに登場したプロジェクトの現在の`opencode.json`/`opencode.jsonc`と、opencodeのグローバル設定を分析する。

必ず以下を明示する。

```text
この分析は現在のファイル状態に基づくものであり、過去セッション時点で同じ内容が存在していたことは保証しません。
```

見る観点:

- `$schema`が設定されているか
- モデル、権限、MCP、instructions、skills.pathsなどが適切に使われているか
- グローバル設定とプロジェクト設定の役割が分かれているか
- 秘密情報が設定ファイルに直接書かれていないか

### 9. 現在のCLAUDE.md/AGENTS.md整備状況

`project_assets.projects[].claude_md`、`project_assets.projects[].agents_md`、`global_assets.assets.claude_md`、`global_assets.assets.agents_md`をもとに、ログに登場したプロジェクトの現在の`CLAUDE.md`/`AGENTS.md`と、opencodeのグローバル設定およびClaude/Agents互換ディレクトリに現在存在する指示ファイルを分析する。

必ず以下を明示する。

```text
この分析は現在のファイル状態に基づくものであり、過去セッション時点で同じ内容が存在していたことは保証しません。
```

見る観点:

- opencodeで使う共通指示が`CLAUDE.md`または`AGENTS.md`に明確に書かれているか
- プロジェクト固有の技術スタック、検証コマンド、制約が書かれているか
- グローバル指示とプロジェクト指示の役割が分かれているか
- `CLAUDE.md`と`AGENTS.md`が重複または矛盾していないか
- opencode設定の`instructions`と手動配置された指示ファイルの関係が分かりやすいか

### 10. 現在のSKILLS整備状況

`project_assets.projects[].skills`と`global_assets.assets.skills`をもとに、ログに登場したプロジェクトの現在のSkill整備状況と、opencodeのグローバルSkill整備状況を分析する。

opencodeは`.opencode/skills`だけでなく、`.claude/skills`や`.agents/skills`のSkillも共用できるため、Claude Code用途のSkillもopencode利用改善の観点で評価する。

見る観点:

- Skillの有無
- Skill名とdescriptionの明確さ
- 使用条件の明確さ
- ワークフローの具体性
- 似た責務のSkillが重複していないか
- `.opencode/skills`、`.claude/skills`、`.agents/skills`、`skills/`のどこに置くべきかが役割に合っているか
- グローバルSkillとして置くべき汎用Skillと、プロジェクトSkillとして置くべき固有Skillが分かれているか

### 11. 現在のAgent/Command整備状況

`project_assets.projects[].agents`、`project_assets.projects[].commands`、`global_assets.assets.agents`、`global_assets.assets.commands`をもとに分析する。

見る観点:

- よく繰り返すレビュー、調査、実装、検証作業がAgentやCommandとして切り出されているか
- Agentのdescriptionとpermissionが役割に合っているか
- Commandのtemplateが具体的で再利用しやすいか
- Skill、Agent、Commandの責務が混ざっていないか

### 12. 次回から使うプロンプトテンプレート

分析結果をもとに、次回から使えるテンプレートを複数提示する。

最低限、以下を含める。

- デバッグ依頼テンプレート
- 実装依頼テンプレート
- レビュー依頼テンプレート
- 短文承認テンプレート

### 13. 次の1週間で試す運用改善

実行しやすい改善策を3から5個に絞って提示する。

各改善策は、具体的な行動として書く。

## トーン

- 率直に書く。
- ただし断定しすぎない。
- ユーザーの能力評価ではなく、opencodeとの協働改善として書く。
- 問題点よりも、次にどう依頼すればよいかを重視する。
