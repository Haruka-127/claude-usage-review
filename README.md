# Usage Review Skills

AI coding agentの過去ログと現在の設定/Skill構成をもとに、ユーザーの使い方を改善するためのAgent Skill集です。

- `claude-usage-review`: Claude Codeの過去ログと、現在の`CLAUDE.md`/Skill構成を分析します。
- `opencode-usage-review`: opencodeのSQLite過去ログと、現在の`opencode.json`/`CLAUDE.md`/`AGENTS.md`/Skill/Agent/Command構成を分析します。

## Install

```bash
npx skills add Haruka-127/claude-usage-review
```

ローカルからインストールする場合:

```bash
npx skills add .
```

## Skill Contents

- `skills/claude-usage-review/SKILL.md`: Skill本体
- `skills/claude-usage-review/report-format.md`: レポート形式
- `skills/claude-usage-review/scripts/collect.ts`: Claude Codeログと現在のProject/Global assetsを収集するTypeScriptスクリプト
- `skills/opencode-usage-review/SKILL.md`: opencode用Skill本体
- `skills/opencode-usage-review/report-format.md`: opencode用レポート形式
- `skills/opencode-usage-review/scripts/collect.ts`: opencode SQLiteログと現在のProject/Global assets（`CLAUDE.md`/`AGENTS.md`を含む）を収集するTypeScriptスクリプト
