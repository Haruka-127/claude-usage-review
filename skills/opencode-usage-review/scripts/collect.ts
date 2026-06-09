#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
// node:sqlite is available in Node 22+ and is currently marked experimental.
// @ts-ignore
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DAYS = 7;
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_EPISODES = 200;
const DEFAULT_MAX_EXCERPT_CHARS = 1200;

const SKIP_USER_PROMPT_PREFIXES = ["/clear", "/help"];
const TOOL_EDIT_NAMES = new Set(["edit", "multiedit", "write", "patch", "apply_patch", "Edit", "MultiEdit", "Write"]);

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(api[_-]?key|apikey)\s*[:=]\s*\S+/gi, "API_KEY"],
  [/(secret|token|password|passwd|pwd)\s*[:=]\s*\S+/gi, "SECRET"],
  [/(access[_-]?key|secret[_-]?key)\s*[:=]\s*\S+/gi, "ACCESS_KEY"],
  [/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, "BEARER_TOKEN"],
  [/sk-[A-Za-z0-9]{20,}/g, "OPENAI_API_KEY"],
  [/sk-ant-[A-Za-z0-9\-]{20,}/g, "ANTHROPIC_API_KEY"],
  [/gh[pousr]_[A-Za-z0-9_]{20,}/g, "GITHUB_TOKEN"],
  [/AIza[A-Za-z0-9\-_]{35}/g, "GOOGLE_API_KEY"],
  [/(mongodb(?:\+srv)?:\/\/)[^\s:@]+:[^\s@]+@\S+/gi, "MONGODB_URI"],
  [/(postgres(?:ql)?:\/\/)[^\s:@]+:[^\s@]+@\S+/gi, "POSTGRES_URI"],
  [/(mysql:\/\/)[^\s:@]+:[^\s@]+@\S+/gi, "MYSQL_URI"],
  [/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, "PRIVATE_KEY"],
];

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const FILE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "py", "rs", "go", "java", "kt", "cs", "cpp", "c", "h", "hpp", "css", "scss", "html", "yml", "yaml", "toml", "lock", "sql"];
const FILE_REFERENCE_PATTERN = new RegExp(`(?:^|[\\s、。])(?:[^\\s、。]+\\.(?:${FILE_EXTENSIONS.join("|")})|[A-Za-z]:\\\\[^\\s]+)`, "i");
const ERROR_PATTERN = termsPattern(["error", "exception", "traceback", "failed", "failure", "stack trace", "エラー", "失敗", "例外", "落ちる", "動かない"]);
const TASK_GOAL_PATTERN = termsPattern(["直して", "修正", "実装", "追加", "作成", "レビュー", "調査", "分析", "整理", "改善", "対応", "変更", "変換", "生成", "更新", "削除", "移行", "リファクタ", "マージ", "報告", "提示", "抽出", "インストール", "テスト", "できるように", "してほしい", "してください", "考えて", "fix", "implement", "add", "create", "review", "investigate", "analyze", "refactor", "update", "remove", "migrate", "merge", "report", "show", "extract", "install", "test", "generate"]);
const EXPLICIT_EXPECTED_RESULT_PATTERN = termsPattern(["expected result", "expected behavior", "expectation", "should be", "should work", "goal is", "acceptance", "done when", "期待結果", "期待する結果", "期待する挙動", "想定結果", "想定する挙動", "こうなって", "こうしたい", "目的は", "ゴールは", "完了条件", "成功条件", "受け入れ条件", "満たす", "通る状態", "できる状態", "出力形式", "最終的に", "以下の形", "次の形式"]);
const EXPECTED_STATE_PATTERN = termsPattern(["できるように", "動くように", "通るように", "表示されるように", "保存されるように", "生成されるように", "エラーが出ない", "エラーなく", "失敗しない", "問題なく", "状態にして", "形にして", "使えるように", "読めるように", "分かるように", "work", "works", "pass", "passes", "without error", "without errors", "no error", "no errors"]);
const QUALITY_CONSTRAINT_PATTERN = termsPattern(["壊さず", "壊さない", "維持したまま", "保持したまま", "適切に", "完璧な", "安全に", "漏れなく", "網羅的に", "一貫した", "without breaking", "preserve", "safely", "properly", "completely"]);
const VERIFICATION_COMMAND_PATTERN = /(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|lint|build|typecheck|check))|(?:pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|ruff|eslint|tsc|vitest|jest|playwright|cypress)/i;
const PLAN_PATTERN = termsPattern(["plan", "steps", "approach", "方針", "計画", "手順", "進め方", "実装方針", "選択肢", "これから"]);
const NOT_VERIFIED_PATTERN = termsPattern(["not verified", "not tested", "did not run", "unable to verify", "未検証", "テストは実行していません", "確認していません", "検証できていません"]);
const CORRECTION_PATTERN = termsPattern(["違う", "直ってない", "まだ", "再修正", "修正して", "エラー", "失敗", "動かない", "not fixed", "still", "failed", "wrong", "again"]);
const SATISFIED_PATTERN = termsPattern(["ありがとう", "助かりました", "ok", "OK", "LGTM", "よさそう", "大丈夫", "完了", "thanks", "thank you"]);
const SCOPE_LIMIT_PATTERN = termsPattern(["だけ", "のみ", "以外", "触らない", "変更しない", "変更せず", "変更は行わない", "変更を行わない", "行わないで", "ほとんど変更せず", "維持したまま", "保持したまま", "壊さず", "壊さない", "そのまま", "範囲", "スコープ", "対象", "除外", "限定", "do not", "only", "except", "scope", "without changing", "without breaking", "preserve"]);
const OUTPUT_FORMAT_PATTERN = termsPattern(["JSON形式", "Markdown形式", "マークダウン", "表形式", "箇条書き", "テンプレート", "形式で", "フォーマット", "出力形式", "レポートとして", "table format", "bullet list", "markdown format", "json format", "output format", "template", "report format"]);
const ACCEPTANCE_CRITERIA_PATTERN = termsPattern(["完了条件", "成功条件", "受け入れ条件", "acceptance criteria", "done when", "definition of done", "満たす", "通ること", "エラーが出ない", "成功すること"]);
const REPRODUCTION_STEPS_PATTERN = termsPattern(["再現", "手順", "steps to reproduce", "repro", "実行すると", "クリック", "入力して", "起動して", "開くと"]);
const RECENT_CHANGE_PATTERN = termsPattern(["直近", "さっき", "先ほど", "変更した", "追加した", "更新した", "マージ後", "after changing", "recently changed", "just changed"]);
const API_ERROR_PATTERN = termsPattern(["API Error", "usage limits", "rate limit", "quota", "429", "400"]);
const USER_ABORT_PATTERN = termsPattern(["Cancelled", "キャンセル", "中断", "aborted", "interrupted"]);
const QUESTION_PATTERN = termsPattern(["?", "？", "どう", "なぜ", "どの", "どれ", "何", "教えて", "説明", "確認したい", "相談", "why", "how", "what", "which", "explain"]);
const INVESTIGATION_PATTERN = termsPattern(["調査", "調べて", "分析", "報告", "洗い出し", "確認したい", "investigate", "research", "analyze", "report", "inspect"]);
const REVIEW_PATTERN = termsPattern(["レビューして", "レビューしてください", "コードレビュー", "計画書をレビュー", "変更についてレビュー", "確認して", "チェック", "見て", "review", "check"]);
const WRITING_PATTERN = termsPattern(["コミットメッセージ", "commit message", "文章", "文面", "下書き", "清書", "要約", "まとめ", "レポート", "write", "draft", "summarize", "summary"]);
const IMPLEMENTATION_PATTERN = termsPattern(["実装", "追加", "作成", "修正", "変更", "更新", "削除", "移行", "リファクタ", "直して", "マージ", "インストール", "テスト", "implement", "add", "create", "fix", "update", "remove", "migrate", "refactor", "merge", "install", "test"]);
const PLANNING_PATTERN = termsPattern(["計画", "方針", "設計", "要件", "整理", "考えて", "plan", "design", "requirements"]);
const TOOL_RESULT_FAILURE_PATTERN = /(?:exit code\s*[:=]?\s*[1-9]\d*|command failed|failed|error|エラー|失敗)/i;
const STATUS_UPDATE_PATTERN = termsPattern(["しました", "完了しました", "対応しました", "修正しました", "変更しました", "作成しました", "追加しました", "できました", "終わりました", "I fixed", "I changed", "I added", "done", "completed"]);
const STATUS_FOLLOWUP_REQUEST_PATTERN = termsPattern(["ください", "お願いします", "してほしい", "確認して", "レビューして", "続けて", "進めて", "実行して", "見て", "please", "can you", "could you", "would you"]);
const CONTEXT_ONLY_PATTERN = /(?:です|でした|ます|ました|である|と思います|と考えています)$/;

type Confidence = "high" | "medium" | "low" | "unknown";
type ProjectEvidence = "worktree" | "session_directory" | "message_cwd" | "unknown";
type ExpectedResultStrength = "explicit" | "implicit" | "none";
type PromptIntent = "approval" | "debugging" | "implementation" | "review" | "investigation" | "planning" | "writing" | "question" | "other";
type DeliverableType = "commit_message" | "report" | "summary" | "plan" | "review" | "template" | "code" | "unknown";
type ToolCategory = "exploration" | "editing" | "verification" | "git" | "other_bash" | "other";
type VerificationStatus = "verified" | "attempted_failed" | "attempted_unknown" | "not_attempted";

type ToolUse = { id: string; name: string; input: unknown };
type ToolResult = { toolUseId: string; isError: boolean; textExcerpt: string };

type NormalizedEvent = {
  rawType: string;
  role: "user" | "assistant" | "other";
  timestampMs: number | null;
  timestamp: string | null;
  cwd: string | null;
  userText: string;
  assistantText: string;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  isActualUserPrompt: boolean;
};

type SessionData = {
  id: string;
  dbPath: string;
  events: NormalizedEvent[];
  projectPath: string | null;
  projectName: string;
  projectConfidence: Confidence;
  projectEvidence: ProjectEvidence;
  latestTimestampMs: number | null;
};

type CliOptions = {
  all: boolean;
  days: number;
  project: string | null;
  dataRoot: string;
  configRoot: string;
  out: string | null;
  maxSessions: number;
  maxEpisodes: number;
  maxExcerptChars: number;
  includeAssets: boolean;
};

type CollectionStats = {
  dbPathsFound: number;
  dbPathsScanned: number;
  sessionsFound: number;
  sessionsScanned: number;
  messagesRead: number;
  partsRead: number;
  parseErrors: number;
  skippedMetaMessages: number;
  rawEventCounts: Record<string, number>;
  excludedUserEventCounts: Record<string, number>;
  unknownEvents: number;
  redactionsApplied: number;
};

type PromptEpisode = {
  episode_id: string;
  session_id: string;
  timestamp: string | null;
  project: { path: string | null; name: string; confidence: Confidence; evidence: ProjectEvidence };
  user_prompt: {
    excerpt: string;
    normalized_excerpt: string;
    char_count: number;
    line_count: number;
    prompt_intent: PromptIntent;
    deliverable_type: DeliverableType;
    looks_like_short_approval: boolean;
    has_file_reference: boolean;
    has_error_excerpt: boolean;
    has_expected_result: boolean;
    has_task_goal: boolean;
    has_explicit_expected_result: boolean;
    expected_result_strength: ExpectedResultStrength;
    expected_result_evidence: string[];
    has_scope_limit: boolean;
    has_output_format: boolean;
    has_acceptance_criteria: boolean;
    has_reproduction_steps: boolean;
    has_recent_change_context: boolean;
    has_verification_command: boolean;
  };
  before_context: { previous_assistant_excerpt: string; previous_assistant_had_plan: boolean };
  after_behavior: {
    tool_call_count: number;
    tool_counts: Record<string, number>;
    tool_categories: Record<ToolCategory, number>;
    first_edit_after_tool_calls: number | null;
    bash_failures: number;
    repeated_bash_commands: string[];
    bash_commands: string[];
    files_read: string[];
    files_edited: string[];
    had_file_edit: boolean;
    had_verification_command: boolean;
    verification_status: VerificationStatus;
  };
  outcome: {
    assistant_final_excerpt: string;
    mentions_not_verified: boolean;
    ended_with_api_error: boolean;
    ended_with_user_abort: boolean;
    ended_with_tool_error: boolean;
    next_user_prompt_type: "correction" | "satisfied" | "follow_up" | "none";
  };
};

type ProjectAggregate = { path: string; sessionIds: Set<string>; lastSeenMs: number | null };

type AssetFile = { path: string; size_bytes: number; headings: string[]; excerpt: string };
type NamedAsset = { name: string; path: string; size_bytes: number; has_description: boolean; has_usage_guidance: boolean; excerpt: string };

type ProjectAsset = {
  project_path: string;
  project_name: string;
  seen_in_logs: boolean;
  session_count: number;
  last_seen_at: string | null;
  configs: { exists: boolean; paths: AssetFile[] };
  claude_md: { exists: boolean; paths: AssetFile[] };
  agents_md: { exists: boolean; paths: AssetFile[] };
  skills: { exists: boolean; count: number; items: NamedAsset[] };
  agents: { exists: boolean; count: number; items: NamedAsset[] };
  commands: { exists: boolean; count: number; items: NamedAsset[] };
};

type GlobalAsset = Omit<ProjectAsset, "project_path" | "project_name" | "seen_in_logs" | "session_count" | "last_seen_at"> & { config_root: string };

const DELIVERABLE_PATTERNS: Array<[DeliverableType, RegExp]> = [
  ["commit_message", termsPattern(["コミットメッセージ", "commit message"])],
  ["report", termsPattern(["レポート", "報告", "report"])],
  ["summary", termsPattern(["まとめ", "要約", "summary", "summarize"])],
  ["plan", termsPattern(["計画", "実装計画書", "plan"])],
  ["review", termsPattern(["レビュー", "review"])],
  ["template", termsPattern(["テンプレート", "template"])],
  ["code", termsPattern(["コード", "実装", "code", "implementation"])],
];

function termsPattern(terms: string[]): RegExp {
  return new RegExp(`(?:${terms.map(termToPatternSource).join("|")})`, "i");
}

function termToPatternSource(term: string): string {
  const escaped = escapeRegExp(term).replace(/\\ /g, "\\s+");
  return /^[A-Za-z0-9][A-Za-z0-9\s_-]*$/.test(term) ? `\\b${escaped}\\b` : escaped;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    all: false,
    days: DEFAULT_DAYS,
    project: null,
    dataRoot: process.env.OPENCODE_DATA_DIR || path.join(os.homedir(), ".local", "share", "opencode"),
    configRoot: process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"),
    out: null,
    maxSessions: DEFAULT_MAX_SESSIONS,
    maxEpisodes: DEFAULT_MAX_EPISODES,
    maxExcerptChars: DEFAULT_MAX_EXCERPT_CHARS,
    includeAssets: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--all": options.all = true; break;
      case "--days": options.days = readNumberOption(arg, next); i++; break;
      case "--project": options.project = readStringOption(arg, next); i++; break;
      case "--data-root": options.dataRoot = expandHome(readStringOption(arg, next)); i++; break;
      case "--config-root": options.configRoot = expandHome(readStringOption(arg, next)); i++; break;
      case "--out": options.out = readStringOption(arg, next); i++; break;
      case "--max-sessions": options.maxSessions = readNumberOption(arg, next); i++; break;
      case "--max-episodes": options.maxEpisodes = readNumberOption(arg, next); i++; break;
      case "--max-excerpt-chars": options.maxExcerptChars = readNumberOption(arg, next); i++; break;
      case "--include-assets": options.includeAssets = true; break;
      case "--no-assets": options.includeAssets = false; break;
      case "--help":
      case "-h": printHelpAndExit(); break;
      default: if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.dataRoot = expandHome(options.dataRoot);
  options.configRoot = expandHome(options.configRoot);
  return options;
}

function readStringOption(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function readNumberOption(name: string, value: string | undefined): number {
  const parsed = Number(readStringOption(name, value));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} requires a non-negative number`);
  return parsed;
}

function printHelpAndExit(): never {
  console.log(`Usage: npx tsx collect.ts [options]

Options:
  --all                       Collect all available opencode logs
  --days <n>                  Collect logs from the last n days (default: 7)
  --project <name>            Filter projects by partial name/path match
  --data-root <path>          opencode data directory (default: OPENCODE_DATA_DIR or ~/.local/share/opencode)
  --config-root <path>        opencode config directory (default: OPENCODE_CONFIG_DIR or ~/.config/opencode)
  --out <path>                Write JSON to file instead of stdout
  --max-sessions <n>          Maximum sessions to scan (default: 50)
  --max-episodes <n>          Maximum Prompt Episodes to output (default: 200)
  --max-excerpt-chars <n>     Maximum excerpt length (default: 1200)
  --include-assets            Include current project/global opencode assets (default)
  --no-assets                 Skip current project/global asset discovery`);
  process.exit(0);
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function toIso(ms: number | null): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  try { return new Date(ms).toISOString(); } catch { return null; }
}

function cutoffMs(options: CliOptions): number | null {
  if (options.all || options.days === 0) return null;
  return Date.now() - options.days * 24 * 60 * 60 * 1000;
}

function normalizeSlashes(input: string): string { return input.replace(/\\/g, "/"); }
function basenameSafe(input: string | null): string { return input ? path.basename(input) || "unknown" : "unknown"; }
function stableHash(input: string): string { return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12); }
function escapeRegExp(input: string): string { return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function pathExists(input: string): Promise<boolean> {
  try { await fs.access(input); return true; } catch { return false; }
}

async function isDirectory(input: string): Promise<boolean> {
  try { return (await fs.stat(input)).isDirectory(); } catch { return false; }
}

let redactionsApplied = 0;

function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.normalize("NFKC").replace(/[\uD800-\uDFFF]/g, "").trim();
}

function normalizeUserPromptText(input: string): string {
  let text = sanitizeText(input).replace(/\r\n?/g, "\n");
  text = removeInjectedXmlBlocks(text);
  return text.split("\n").map((line) => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean).join("\n").trim();
}

function removeInjectedXmlBlocks(input: string): string {
  const injectedTags = ["ide_opened_file", "ide_selection", "local-command-caveat", "local-command-stdout", "system-reminder", "command-name", "command-message", "command-args"];
  let text = input;
  for (const tag of injectedTags) text = text.replace(new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>[\\s\\S]*?<\\/${escapeRegExp(tag)}>`, "gi"), "\n");
  return text;
}

function redactText(input: string, maxChars: number): string {
  let text = sanitizeText(input);
  const before = text;
  const home = os.homedir();
  text = text.replace(new RegExp(escapeRegExp(home), "gi"), "<HOME>");
  text = normalizeSlashes(text).replace(new RegExp(escapeRegExp(normalizeSlashes(home)), "gi"), "<HOME>");
  text = text.replace(EMAIL_PATTERN, "<EMAIL>");
  for (const [pattern, label] of SECRET_PATTERNS) text = text.replace(pattern, `<SECRET:${label}>`);
  if (text !== before) redactionsApplied++;
  if (text.length > maxChars) return `${text.slice(0, maxChars)}... <TRUNCATED:${text.length - maxChars}_CHARS>`;
  return text;
}

function redactPath(input: string | null, maxChars = DEFAULT_MAX_EXCERPT_CHARS): string | null {
  return input ? redactText(normalizeSlashes(input), maxChars) : null;
}

function relativeRedactedPath(root: string, target: string): string {
  return normalizeSlashes(path.relative(root, target) || path.basename(target));
}

async function discoverDbPaths(options: CliOptions, stats: CollectionStats): Promise<string[]> {
  if (!(await isDirectory(options.dataRoot))) return [];
  const candidates: string[] = [];
  const primary = path.join(options.dataRoot, "opencode.db");
  if (await pathExists(primary)) candidates.push(primary);
  const entries = await fs.readdir(options.dataRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && /^opencode-.+\.db$/.test(entry.name)) candidates.push(path.join(options.dataRoot, entry.name));
  }
  stats.dbPathsFound = candidates.length;
  return [...new Set(candidates)];
}

function tableExists(db: any, name: string): boolean {
  const row = db.prepare("select name from sqlite_master where type = 'table' and name = ?").get(name);
  return Boolean(row);
}

function readSessionsFromDb(dbPath: string, options: CliOptions, stats: CollectionStats): SessionData[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (!tableExists(db, "session") || !tableExists(db, "message") || !tableExists(db, "part")) return [];
    const hasProject = tableExists(db, "project");
    const cutoff = cutoffMs(options);
    const sql = hasProject
      ? "select s.id, s.project_id, s.directory, s.title, s.time_created, s.time_updated, p.worktree, p.name as project_name from session s left join project p on p.id = s.project_id where s.parent_id is null order by s.time_updated desc limit ?"
      : "select s.id, s.project_id, s.directory, s.title, s.time_created, s.time_updated, null as worktree, null as project_name from session s where s.parent_id is null order by s.time_updated desc limit ?";
    const rows = db.prepare(sql).all(Math.max(options.maxSessions * 4, options.maxSessions));
    stats.sessionsFound += rows.length;
    const sessions: SessionData[] = [];

    for (const row of rows) {
      const updated = numberValue(row.time_updated) || numberValue(row.time_created);
      if (cutoff && updated && updated < cutoff) continue;
      const projectPath = stringValue(row.worktree) || stringValue(row.directory) || null;
      const projectName = stringValue(row.project_name) || basenameSafe(projectPath) || stringValue(row.project_id) || "unknown";
      if (options.project && !matchesProjectFilter(options.project, [projectName, projectPath, stringValue(row.title), stringValue(row.id)])) continue;
      const session = readSessionEvents(db, dbPath, String(row.id), projectPath, projectName, options, stats);
      if (session.events.length > 0) sessions.push(session);
      stats.sessionsScanned++;
      if (sessions.length >= options.maxSessions) break;
    }
    return sessions;
  } finally {
    db.close();
  }
}

function readSessionEvents(db: any, dbPath: string, sessionId: string, projectPath: string | null, projectName: string, options: CliOptions, stats: CollectionStats): SessionData {
  const messageRows = db.prepare("select id, time_created, time_updated, data from message where session_id = ? order by time_created asc, id asc").all(sessionId);
  const partRows = db.prepare("select id, message_id, time_created, data from part where session_id = ? order by time_created asc, id asc").all(sessionId);
  stats.messagesRead += messageRows.length;
  stats.partsRead += partRows.length;

  const partsByMessage = new Map<string, any[]>();
  for (const part of partRows) {
    const messageId = String(part.message_id || "");
    const existing = partsByMessage.get(messageId) || [];
    existing.push(part);
    partsByMessage.set(messageId, existing);
  }

  const events: NormalizedEvent[] = [];
  for (const message of messageRows) {
    const normalized = normalizeDbMessage(message, partsByMessage.get(String(message.id)) || [], projectPath, options, stats);
    if (normalized) events.push(normalized);
  }

  const inferred = inferProjectPath(events, projectPath);
  return {
    id: sessionId,
    dbPath,
    events,
    projectPath: inferred.path,
    projectName,
    projectConfidence: inferred.confidence,
    projectEvidence: inferred.evidence,
    latestTimestampMs: latestMs(events.map((event) => event.timestampMs)),
  };
}

function normalizeDbMessage(messageRow: any, partRows: any[], fallbackProjectPath: string | null, options: CliOptions, stats: CollectionStats): NormalizedEvent | null {
  const messageData = parseJsonObject(messageRow.data, stats);
  if (!messageData) return null;
  const role = messageData.role === "user" ? "user" : messageData.role === "assistant" ? "assistant" : "other";
  const rawType = role;
  incrementCount(stats.rawEventCounts, rawType);
  const timestampMs = numberValue(messageRow.time_created) || numberValue(messageData.time?.created);
  const cwd = stringValue(messageData.path?.cwd) || fallbackProjectPath;
  const parsedParts = partRows.map((row) => parseJsonObject(row.data, stats)).filter(Boolean) as any[];

  const userText = role === "user" ? extractUserTextFromParts(parsedParts) : "";
  const assistantText = role === "assistant" ? extractAssistantTextFromParts(parsedParts) : "";
  const toolUses = role === "assistant" ? extractToolUsesFromParts(parsedParts) : [];
  const toolResults = role === "assistant" ? extractToolResultsFromParts(parsedParts, options.maxExcerptChars) : [];
  const exclusion = role === "user" ? getUserPromptExclusionReason(userText) : null;
  const isActualUserPrompt = role === "user" && exclusion === null;

  if (role === "user" && exclusion) incrementCount(stats.excludedUserEventCounts, exclusion);
  if (role === "other") stats.unknownEvents++;

  return { rawType, role, timestampMs, timestamp: toIso(timestampMs), cwd, userText, assistantText, toolUses, toolResults, isActualUserPrompt };
}

function parseJsonObject(value: unknown, stats: CollectionStats): any | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    stats.parseErrors++;
    return null;
  }
}

function extractUserTextFromParts(parts: any[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type !== "text") continue;
    if (part.synthetic === true || part.ignored === true) continue;
    const text = normalizeUserPromptText(part.text || "");
    if (text) texts.push(text);
  }
  return normalizeUserPromptText(texts.join("\n"));
}

function extractAssistantTextFromParts(parts: any[]): string {
  return parts.filter((part) => part.type === "text").map((part) => sanitizeText(part.text || "")).filter(Boolean).join("\n").trim();
}

function extractToolUsesFromParts(parts: any[]): ToolUse[] {
  const tools: ToolUse[] = [];
  for (const part of parts) {
    if (part.type !== "tool") continue;
    tools.push({ id: String(part.callID || part.id || ""), name: String(part.tool || "unknown"), input: part.state?.input ?? {} });
  }
  return tools;
}

function extractToolResultsFromParts(parts: any[], maxChars: number): ToolResult[] {
  const results: ToolResult[] = [];
  for (const part of parts) {
    if (part.type !== "tool") continue;
    const state = part.state || {};
    if (!state.status || state.status === "running") continue;
    const text = typeof state.output === "string" ? state.output : typeof state.error === "string" ? state.error : typeof state.metadata?.output === "string" ? state.metadata.output : JSON.stringify(state.output ?? state.error ?? "");
    results.push({ toolUseId: String(part.callID || part.id || ""), isError: state.status === "error" || Boolean(state.error), textExcerpt: redactText(text, Math.min(maxChars, 500)) });
  }
  return results;
}

function getUserPromptExclusionReason(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (/^\[Request interrupted by user(?: for tool use)?\]$/i.test(trimmed)) return "user_interrupt_marker";
  if (SKIP_USER_PROMPT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "slash_command";
  if (/^<(?:ide_opened_file|ide_selection|local-command-caveat|local-command-stdout|system-reminder|command-name|command-message|command-args)\b/.test(trimmed)) return "injected_context";
  const pathLikeOnly = trimmed.length < 300 && !trimmed.includes(" ") && /^(?:[A-Za-z]:[\\/]|\/|\.\/|\.\.\/)/.test(trimmed);
  if (pathLikeOnly) return "path_only";
  return null;
}

function buildEpisodes(sessions: SessionData[], options: CliOptions): PromptEpisode[] {
  const episodes: PromptEpisode[] = [];
  for (const session of sessions) {
    const userIndexes = session.events.map((event, index) => ({ event, index })).filter(({ event }) => event.isActualUserPrompt);
    for (let turn = 0; turn < userIndexes.length; turn++) {
      if (episodes.length >= options.maxEpisodes) return episodes;
      const current = userIndexes[turn];
      const next = userIndexes[turn + 1] || null;
      const beforeEvents = session.events.slice(0, current.index);
      const afterEvents = session.events.slice(current.index + 1, next ? next.index : session.events.length);
      const previousAssistant = findPreviousAssistant(beforeEvents);
      const behavior = summarizeAfterBehavior(afterEvents);
      const finalAssistantText = findFinalAssistantText(afterEvents);
      const userText = current.event.userText;
      const promptSignals = analyzeUserPrompt(userText);
      const projectPath = current.event.cwd || session.projectPath;

      episodes.push({
        episode_id: `${stableHash(session.id)}:turn-${turn + 1}`,
        session_id: stableHash(session.id),
        timestamp: current.event.timestamp,
        project: { path: redactPath(projectPath, options.maxExcerptChars), name: basenameSafe(projectPath) || session.projectName, confidence: projectPath ? session.projectConfidence : "unknown", evidence: projectPath ? (current.event.cwd ? "message_cwd" : session.projectEvidence) : "unknown" },
        user_prompt: {
          excerpt: redactText(userText, options.maxExcerptChars),
          normalized_excerpt: redactText(promptSignals.normalizedText, options.maxExcerptChars),
          char_count: userText.length,
          line_count: userText.split(/\r?\n/).length,
          prompt_intent: promptSignals.promptIntent,
          deliverable_type: promptSignals.deliverableType,
          looks_like_short_approval: promptSignals.looksLikeShortApproval,
          has_file_reference: promptSignals.hasFileReference,
          has_error_excerpt: promptSignals.hasErrorExcerpt,
          has_expected_result: promptSignals.expectedResultStrength === "explicit",
          has_task_goal: promptSignals.hasTaskGoal,
          has_explicit_expected_result: promptSignals.expectedResultStrength === "explicit",
          expected_result_strength: promptSignals.expectedResultStrength,
          expected_result_evidence: promptSignals.expectedResultEvidence,
          has_scope_limit: promptSignals.hasScopeLimit,
          has_output_format: promptSignals.hasOutputFormat,
          has_acceptance_criteria: promptSignals.hasAcceptanceCriteria,
          has_reproduction_steps: promptSignals.hasReproductionSteps,
          has_recent_change_context: promptSignals.hasRecentChangeContext,
          has_verification_command: promptSignals.hasVerificationCommand,
        },
        before_context: { previous_assistant_excerpt: redactText(previousAssistant, options.maxExcerptChars), previous_assistant_had_plan: PLAN_PATTERN.test(previousAssistant) },
        after_behavior: behavior,
        outcome: {
          assistant_final_excerpt: redactText(finalAssistantText, options.maxExcerptChars),
          mentions_not_verified: NOT_VERIFIED_PATTERN.test(finalAssistantText),
          ended_with_api_error: API_ERROR_PATTERN.test(finalAssistantText),
          ended_with_user_abort: USER_ABORT_PATTERN.test(finalAssistantText),
          ended_with_tool_error: behavior.bash_failures > 0 && !finalAssistantText,
          next_user_prompt_type: classifyNextUserPrompt(next?.event.userText || ""),
        },
      });
    }
  }
  return episodes;
}

function findPreviousAssistant(events: NormalizedEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].assistantText) return events[i].assistantText;
  return "";
}

function findFinalAssistantText(events: NormalizedEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].assistantText) return events[i].assistantText;
  return "";
}

function summarizeAfterBehavior(events: NormalizedEvent[]): PromptEpisode["after_behavior"] {
  const toolCounts: Record<string, number> = {};
  const toolCategories: Record<ToolCategory, number> = { exploration: 0, editing: 0, verification: 0, git: 0, other_bash: 0, other: 0 };
  const toolById = new Map<string, ToolUse>();
  const bashCommands: string[] = [];
  const verificationToolIds = new Set<string>();
  const verificationResultByToolId = new Map<string, boolean>();
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  let toolCallCount = 0;
  let bashFailures = 0;
  let hadFileEdit = false;
  let hadVerificationCommand = false;
  let firstEditAfterToolCalls: number | null = null;

  for (const event of events) {
    for (const tool of event.toolUses) {
      toolCallCount++;
      toolCounts[tool.name] = (toolCounts[tool.name] || 0) + 1;
      if (tool.id) toolById.set(tool.id, tool);
      const category = categorizeToolUse(tool);
      toolCategories[category]++;
      for (const file of extractReadFiles(tool)) filesRead.add(file);
      for (const file of extractEditedFiles(tool)) filesEdited.add(file);
      if (TOOL_EDIT_NAMES.has(tool.name)) {
        hadFileEdit = true;
        if (firstEditAfterToolCalls === null) firstEditAfterToolCalls = toolCallCount - 1;
      }
      if (tool.name.toLowerCase() === "bash") {
        const command = extractBashCommand(tool.input);
        if (command) {
          bashCommands.push(command);
          if (VERIFICATION_COMMAND_PATTERN.test(command)) {
            hadVerificationCommand = true;
            if (tool.id) verificationToolIds.add(tool.id);
          }
        }
      }
    }
    for (const result of event.toolResults) {
      const tool = toolById.get(result.toolUseId);
      const resultFailed = result.isError || toolResultIndicatesFailure(result.textExcerpt);
      if (verificationToolIds.has(result.toolUseId)) verificationResultByToolId.set(result.toolUseId, !resultFailed);
      if (resultFailed && tool?.name.toLowerCase() === "bash") bashFailures++;
    }
  }

  return {
    tool_call_count: toolCallCount,
    tool_counts: toolCounts,
    tool_categories: toolCategories,
    first_edit_after_tool_calls: firstEditAfterToolCalls,
    bash_failures: bashFailures,
    repeated_bash_commands: repeatedValues(bashCommands).map((command) => redactText(command, 300)),
    bash_commands: uniqueValues(bashCommands).map((command) => redactText(command, 300)).slice(0, 20),
    files_read: [...filesRead].map((file) => redactPath(file, 500) || file).slice(0, 50),
    files_edited: [...filesEdited].map((file) => redactPath(file, 500) || file).slice(0, 50),
    had_file_edit: hadFileEdit,
    had_verification_command: hadVerificationCommand,
    verification_status: determineVerificationStatus(hadVerificationCommand, verificationToolIds, verificationResultByToolId),
  };
}

function analyzeUserPrompt(text: string) {
  const normalizedText = normalizeUserPromptText(text);
  const hasVerificationCommand = VERIFICATION_COMMAND_PATTERN.test(normalizedText);
  const hasAcceptanceCriteria = ACCEPTANCE_CRITERIA_PATTERN.test(normalizedText);
  const hasOutputFormat = OUTPUT_FORMAT_PATTERN.test(normalizedText);
  const evidence: string[] = [];
  if (EXPLICIT_EXPECTED_RESULT_PATTERN.test(normalizedText)) evidence.push("explicit_expected_result_phrase");
  if (EXPECTED_STATE_PATTERN.test(normalizedText)) evidence.push("expected_state_phrase");
  if (hasAcceptanceCriteria) evidence.push("acceptance_criteria");
  if (hasOutputFormat) evidence.push("output_format");
  if (hasVerificationCommand) evidence.push("verification_command");
  if (QUALITY_CONSTRAINT_PATTERN.test(normalizedText)) evidence.push("quality_constraint");
  const hasTaskGoal = hasTaskGoalInPrompt(normalizedText);
  const expectedResultStrength: ExpectedResultStrength = evidence.length > 0 ? "explicit" : hasTaskGoal ? "implicit" : "none";
  return {
    normalizedText,
    promptIntent: classifyPromptIntent(normalizedText),
    deliverableType: classifyDeliverableType(normalizedText),
    looksLikeShortApproval: looksLikeShortApproval(normalizedText),
    hasFileReference: FILE_REFERENCE_PATTERN.test(normalizedText),
    hasErrorExcerpt: ERROR_PATTERN.test(normalizedText),
    hasTaskGoal,
    expectedResultStrength,
    expectedResultEvidence: evidence,
    hasScopeLimit: SCOPE_LIMIT_PATTERN.test(normalizedText),
    hasOutputFormat,
    hasAcceptanceCriteria,
    hasReproductionSteps: REPRODUCTION_STEPS_PATTERN.test(normalizedText),
    hasRecentChangeContext: RECENT_CHANGE_PATTERN.test(normalizedText),
    hasVerificationCommand,
  };
}

function hasTaskGoalInPrompt(text: string): boolean {
  if (looksLikeShortApproval(text) || isStatusOnlyPrompt(text) || isContextOnlyPrompt(text)) return false;
  return TASK_GOAL_PATTERN.test(text);
}

function isStatusOnlyPrompt(text: string): boolean { return STATUS_UPDATE_PATTERN.test(text) && !STATUS_FOLLOWUP_REQUEST_PATTERN.test(text); }
function isContextOnlyPrompt(text: string): boolean {
  if (!CONTEXT_ONLY_PATTERN.test(text) || STATUS_FOLLOWUP_REQUEST_PATTERN.test(text) || /[?？]/.test(text)) return false;
  return !/(?:ください|してほしい|したい|考えて|レビューして|調査して|分析して|作成して|実装して|修正して|追加して|変更して|更新して|削除して|マージして|報告して|提示して|抽出して|please|can you|could you|would you)/i.test(text);
}

function classifyPromptIntent(text: string): PromptIntent {
  if (looksLikeShortApproval(text)) return "approval";
  if (isStatusOnlyPrompt(text) || isContextOnlyPrompt(text)) return "other";
  if (ERROR_PATTERN.test(text) || REPRODUCTION_STEPS_PATTERN.test(text)) return "debugging";
  if (WRITING_PATTERN.test(text)) return "writing";
  if (INVESTIGATION_PATTERN.test(text)) return "investigation";
  if (REVIEW_PATTERN.test(text)) return "review";
  if (IMPLEMENTATION_PATTERN.test(text)) return "implementation";
  if (PLANNING_PATTERN.test(text)) return "planning";
  if (QUESTION_PATTERN.test(text)) return "question";
  return "other";
}

function classifyDeliverableType(text: string): DeliverableType {
  for (const [type, pattern] of DELIVERABLE_PATTERNS) if (pattern.test(text)) return type;
  return "unknown";
}

function categorizeToolUse(tool: ToolUse): ToolCategory {
  const name = tool.name.toLowerCase();
  if (["read", "grep", "glob", "list", "ls"].includes(name)) return "exploration";
  if (TOOL_EDIT_NAMES.has(tool.name) || TOOL_EDIT_NAMES.has(name)) return "editing";
  if (name !== "bash") return "other";
  const command = extractBashCommand(tool.input);
  if (VERIFICATION_COMMAND_PATTERN.test(command)) return "verification";
  if (/^\s*git\s+/i.test(command)) return "git";
  return "other_bash";
}

function extractReadFiles(tool: ToolUse): string[] {
  if (!tool.input || typeof tool.input !== "object") return [];
  const input = tool.input as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of ["filePath", "file_path", "path"]) if (typeof input[key] === "string") paths.push(String(input[key]));
  return paths;
}

function extractEditedFiles(tool: ToolUse): string[] {
  if (!tool.input || typeof tool.input !== "object") return [];
  const name = tool.name.toLowerCase();
  if (!TOOL_EDIT_NAMES.has(tool.name) && !TOOL_EDIT_NAMES.has(name)) return [];
  const input = tool.input as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of ["filePath", "file_path", "path"]) if (typeof input[key] === "string") paths.push(String(input[key]));
  if (typeof input.patchText === "string") paths.push(...extractPathsFromPatch(input.patchText));
  return paths;
}

function extractPathsFromPatch(patchText: string): string[] {
  const paths: string[] = [];
  for (const line of patchText.split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (match?.[1]) paths.push(match[1].trim());
  }
  return paths;
}

function determineVerificationStatus(hadVerificationCommand: boolean, verificationToolIds: Set<string>, results: Map<string, boolean>): VerificationStatus {
  if (!hadVerificationCommand) return "not_attempted";
  if ([...verificationToolIds].some((id) => results.get(id) === true)) return "verified";
  if ([...verificationToolIds].some((id) => results.get(id) === false)) return "attempted_failed";
  return "attempted_unknown";
}

function toolResultIndicatesFailure(text: string): boolean { return TOOL_RESULT_FAILURE_PATTERN.test(text); }
function extractBashCommand(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command.trim() : "";
}
function repeatedValues(values: string[]): string[] { const counts = new Map<string, number>(); for (const value of values) counts.set(value, (counts.get(value) || 0) + 1); return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value); }
function uniqueValues(values: string[]): string[] { return [...new Set(values)]; }
function looksLikeShortApproval(text: string): boolean { const trimmed = text.trim(); return trimmed.length <= 40 && trimmed.split(/\s+/).length <= 5 && /^(?:ok|yes|y|お願いします|進めて|それで|はい|頼む|実行して|continue|go ahead|proceed|sounds good)$/i.test(trimmed); }
function classifyNextUserPrompt(text: string): "correction" | "satisfied" | "follow_up" | "none" { const trimmed = text.trim(); if (!trimmed) return "none"; if (CORRECTION_PATTERN.test(trimmed)) return "correction"; if (SATISFIED_PATTERN.test(trimmed)) return "satisfied"; return "follow_up"; }

function inferProjectPath(events: NormalizedEvent[], fallbackPath: string | null): { path: string | null; confidence: Confidence; evidence: ProjectEvidence } {
  const cwdCounts = new Map<string, number>();
  for (const event of events) if (event.cwd) cwdCounts.set(event.cwd, (cwdCounts.get(event.cwd) || 0) + 1);
  const mostCommonCwd = [...cwdCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (mostCommonCwd) return { path: mostCommonCwd, confidence: "high", evidence: "message_cwd" };
  if (fallbackPath) return { path: fallbackPath, confidence: "medium", evidence: "session_directory" };
  return { path: null, confidence: "unknown", evidence: "unknown" };
}

function aggregateProjects(sessions: SessionData[]): Map<string, ProjectAggregate> {
  const projects = new Map<string, ProjectAggregate>();
  for (const session of sessions) {
    if (!session.projectPath) continue;
    const existing = projects.get(session.projectPath) || { path: session.projectPath, sessionIds: new Set<string>(), lastSeenMs: null };
    existing.sessionIds.add(session.id);
    existing.lastSeenMs = Math.max(existing.lastSeenMs || 0, session.latestTimestampMs || 0) || existing.lastSeenMs;
    projects.set(session.projectPath, existing);
  }
  return projects;
}

function latestMs(values: Array<number | null>): number | null { const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)); return valid.length ? Math.max(...valid) : null; }
function incrementCount(target: Record<string, number>, key: string): void { target[key] = (target[key] || 0) + 1; }
function stringValue(value: unknown): string { return typeof value === "string" && value ? value : ""; }
function numberValue(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function matchesProjectFilter(filter: string, values: Array<string | null>): boolean { const needle = filter.toLowerCase(); return values.some((value) => value && value.toLowerCase().includes(needle)); }

async function collectProjectAssets(projects: Map<string, ProjectAggregate>, options: CliOptions): Promise<ProjectAsset[]> {
  const assets: ProjectAsset[] = [];
  for (const project of projects.values()) {
    if (!(await isDirectory(project.path))) continue;
    if (options.project && !project.path.toLowerCase().includes(options.project.toLowerCase())) continue;
    const configs = await collectConfigFiles(project.path, options.maxExcerptChars, false);
    const claudeMd = await collectInstructionFiles(project.path, "CLAUDE.md", options.maxExcerptChars, false);
    const agentsMd = await collectInstructionFiles(project.path, "AGENTS.md", options.maxExcerptChars, false);
    const skills = await collectSkillFiles(project.path, options.maxExcerptChars, false);
    const agents = await collectMarkdownDirectoryFiles(project.path, [path.join(project.path, ".opencode", "agents"), path.join(project.path, ".opencode", "agent")], options.maxExcerptChars);
    const commands = await collectMarkdownDirectoryFiles(project.path, [path.join(project.path, ".opencode", "commands"), path.join(project.path, ".opencode", "command")], options.maxExcerptChars);
    assets.push({
      project_path: redactPath(project.path, options.maxExcerptChars) || "unknown",
      project_name: basenameSafe(project.path),
      seen_in_logs: true,
      session_count: project.sessionIds.size,
      last_seen_at: toIso(project.lastSeenMs),
      configs: { exists: configs.length > 0, paths: configs },
      claude_md: { exists: claudeMd.length > 0, paths: claudeMd },
      agents_md: { exists: agentsMd.length > 0, paths: agentsMd },
      skills: { exists: skills.length > 0, count: skills.length, items: skills },
      agents: { exists: agents.length > 0, count: agents.length, items: agents },
      commands: { exists: commands.length > 0, count: commands.length, items: commands },
    });
  }
  assets.sort((a, b) => b.session_count - a.session_count || a.project_name.localeCompare(b.project_name));
  return assets;
}

async function collectGlobalAssets(options: CliOptions): Promise<GlobalAsset> {
  const configRoot = options.configRoot;
  const configs = await collectConfigFiles(configRoot, options.maxExcerptChars, true);
  const claudeMd = await collectInstructionFiles(configRoot, "CLAUDE.md", options.maxExcerptChars, true);
  const agentsMd = await collectInstructionFiles(configRoot, "AGENTS.md", options.maxExcerptChars, true);
  const skills = await collectSkillFiles(configRoot, options.maxExcerptChars, true);
  const agents = await collectMarkdownDirectoryFiles(configRoot, [path.join(configRoot, "agents"), path.join(configRoot, "agent")], options.maxExcerptChars);
  const commands = await collectMarkdownDirectoryFiles(configRoot, [path.join(configRoot, "commands"), path.join(configRoot, "command")], options.maxExcerptChars);
  return {
    config_root: redactPath(configRoot, options.maxExcerptChars) || "unknown",
    configs: { exists: configs.length > 0, paths: configs },
    claude_md: { exists: claudeMd.length > 0, paths: claudeMd },
    agents_md: { exists: agentsMd.length > 0, paths: agentsMd },
    skills: { exists: skills.length > 0, count: skills.length, items: skills },
    agents: { exists: agents.length > 0, count: agents.length, items: agents },
    commands: { exists: commands.length > 0, count: commands.length, items: commands },
  };
}

async function collectConfigFiles(rootPath: string, maxChars: number, global: boolean): Promise<AssetFile[]> {
  const candidates = global
    ? [path.join(rootPath, "opencode.json"), path.join(rootPath, "opencode.jsonc"), path.join(rootPath, "tui.json"), path.join(rootPath, "tui.jsonc")]
    : [path.join(rootPath, "opencode.json"), path.join(rootPath, "opencode.jsonc"), path.join(rootPath, "tui.json"), path.join(rootPath, "tui.jsonc"), path.join(rootPath, ".opencode", "opencode.json"), path.join(rootPath, ".opencode", "opencode.jsonc"), path.join(rootPath, ".opencode", "tui.json"), path.join(rootPath, ".opencode", "tui.jsonc")];
  const files: AssetFile[] = [];
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue;
    try {
      const stat = await fs.stat(candidate);
      const text = await fs.readFile(candidate, "utf8");
      files.push({ path: relativeRedactedPath(rootPath, candidate), size_bytes: stat.size, headings: extractHeadings(text), excerpt: redactText(text, maxChars) });
    } catch { continue; }
  }
  return files;
}

async function collectInstructionFiles(rootPath: string, fileName: "CLAUDE.md" | "AGENTS.md", maxChars: number, global: boolean): Promise<AssetFile[]> {
  const candidates = global
    ? [
        path.join(rootPath, fileName),
        path.join(os.homedir(), ".claude", fileName),
        path.join(os.homedir(), ".agents", fileName),
      ]
    : [
        path.join(rootPath, fileName),
        path.join(rootPath, ".opencode", fileName),
        path.join(rootPath, ".claude", fileName),
        path.join(rootPath, ".agents", fileName),
      ];
  const files: AssetFile[] = [];
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue;
    try {
      const stat = await fs.stat(candidate);
      const text = await fs.readFile(candidate, "utf8");
      files.push({ path: relativeRedactedPath(rootPath, candidate), size_bytes: stat.size, headings: extractHeadings(text), excerpt: redactText(text, maxChars) });
    } catch { continue; }
  }
  return files;
}

async function collectSkillFiles(rootPath: string, maxChars: number, global: boolean): Promise<NamedAsset[]> {
  const roots = global
    ? [path.join(rootPath, "skills"), path.join(rootPath, "skill"), path.join(os.homedir(), ".claude", "skills"), path.join(os.homedir(), ".agents", "skills")]
    : [path.join(rootPath, ".opencode", "skills"), path.join(rootPath, ".opencode", "skill"), path.join(rootPath, ".claude", "skills"), path.join(rootPath, ".agents", "skills"), path.join(rootPath, "skills")];
  const items: NamedAsset[] = [];
  for (const root of roots) {
    if (!(await isDirectory(root))) continue;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name, "SKILL.md");
      if (!(await pathExists(skillPath))) continue;
      const item = await readNamedMarkdown(rootPath, entry.name, skillPath, maxChars);
      if (item) items.push(item);
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

async function collectMarkdownDirectoryFiles(rootPath: string, roots: string[], maxChars: number): Promise<NamedAsset[]> {
  const items: NamedAsset[] = [];
  for (const root of roots) {
    if (!(await isDirectory(root))) continue;
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const filePath = path.join(root, entry.name);
      const item = await readNamedMarkdown(rootPath, path.basename(entry.name, ".md"), filePath, maxChars);
      if (item) items.push(item);
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

async function readNamedMarkdown(rootPath: string, name: string, filePath: string, maxChars: number): Promise<NamedAsset | null> {
  try {
    const stat = await fs.stat(filePath);
    const text = await fs.readFile(filePath, "utf8");
    return {
      name,
      path: relativeRedactedPath(rootPath, filePath),
      size_bytes: stat.size,
      has_description: /description\s*:/i.test(text),
      has_usage_guidance: /(?:use this skill when|workflow|when to use|ワークフロー|ステップ|手順|使い方|使用条件|基本方針|対象シナリオ|permission|template)/i.test(text),
      excerpt: redactText(text, maxChars),
    };
  } catch { return null; }
}

function extractHeadings(markdown: string): string[] {
  return markdown.split(/\r?\n/).map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim()).filter((heading): heading is string => Boolean(heading)).slice(0, 20);
}

async function buildOutput(options: CliOptions): Promise<unknown> {
  const stats: CollectionStats = { dbPathsFound: 0, dbPathsScanned: 0, sessionsFound: 0, sessionsScanned: 0, messagesRead: 0, partsRead: 0, parseErrors: 0, skippedMetaMessages: 0, rawEventCounts: {}, excludedUserEventCounts: {}, unknownEvents: 0, redactionsApplied: 0 };
  const dbPaths = await discoverDbPaths(options, stats);
  const sessions: SessionData[] = [];
  for (const dbPath of dbPaths) {
    try {
      sessions.push(...readSessionsFromDb(dbPath, options, stats));
      stats.dbPathsScanned++;
    } catch (error) {
      stats.parseErrors++;
    }
    if (sessions.length >= options.maxSessions) break;
  }
  sessions.sort((a, b) => (b.latestTimestampMs || 0) - (a.latestTimestampMs || 0));
  const limitedSessions = sessions.slice(0, options.maxSessions);
  const episodes = buildEpisodes(limitedSessions, options);
  const projects = aggregateProjects(limitedSessions);
  const assets = options.includeAssets ? await collectProjectAssets(projects, options) : [];
  const globalAssets = options.includeAssets ? await collectGlobalAssets(options) : null;
  stats.redactionsApplied = redactionsApplied;

  return {
    meta: {
      generated_at: new Date().toISOString(),
      collector: "opencode-usage-review/scripts/collect.ts",
      scope: options.all || options.days === 0 ? "all" : `last_${options.days}_days`,
      opencode_data_root: redactPath(options.dataRoot),
      opencode_config_root: redactPath(options.configRoot),
      db_paths: dbPaths.map((item) => redactPath(item)),
      project_filter: options.project,
      limits: { max_sessions: options.maxSessions, max_episodes: options.maxEpisodes, max_excerpt_chars: options.maxExcerptChars },
      stats,
    },
    log_analysis: {
      note: "Prompt Episodes are derived from historical opencode SQLite logs.",
      sessions_scanned: limitedSessions.length,
      episodes_count: episodes.length,
      episodes,
    },
    project_assets: {
      note: "Project asset analysis is based on current files in projects seen in the logs. It is not proof that those files influenced historical sessions.",
      projects_count: assets.length,
      projects: assets,
    },
    global_assets: {
      note: "Global asset analysis is based on current files in the opencode config directory and external compatible skill directories. It is not proof that those files influenced historical sessions.",
      assets: globalAssets,
    },
  };
}

async function writeOutput(output: unknown, outPath: string | null): Promise<void> {
  const json = JSON.stringify(output, null, 2);
  if (!outPath) {
    process.stdout.write(json);
    process.stdout.write("\n");
    return;
  }
  const resolved = path.resolve(outPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, json, "utf8");
  console.error(`Wrote ${resolved}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const output = await buildOutput(options);
  await writeOutput(output, options.out);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
