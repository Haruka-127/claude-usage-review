# Claude Usage Review

`claude-usage-review` — Claude Codeの過去ログと、現在の`CLAUDE.md`/Skill構成をもとに、ユーザーのClaude Codeの使い方を改善するためのAgent Skillです。

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
