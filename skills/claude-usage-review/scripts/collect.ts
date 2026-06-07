#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_DAYS = 7;
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_EPISODES = 200;
const DEFAULT_MAX_EXCERPT_CHARS = 1200;

const SKIP_USER_PROMPT_PREFIXES = ["/clear", "/help"];
const TOOL_EDIT_NAMES = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

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
const REQUEST_MARKER_PATTERN = termsPattern(["ください", "して", "お願いします", "ほしい", "たい", "ように", "考えて", "レビュー", "調査", "分析", "作成", "実装", "修正", "追加", "変更", "更新", "削除", "マージ", "報告", "提示", "抽出", "please", "can you", "could you", "would you", "review", "investigate", "analyze", "create", "implement", "fix", "add", "update", "remove", "merge", "report", "show", "extract"]);
const STATUS_UPDATE_PATTERN = termsPattern(["しました", "完了しました", "対応しました", "修正しました", "変更しました", "作成しました", "追加しました", "できました", "終わりました", "I fixed", "I changed", "I added", "done", "completed"]);
const STATUS_FOLLOWUP_REQUEST_PATTERN = termsPattern(["ください", "お願いします", "してほしい", "確認して", "レビューして", "続けて", "進めて", "実行して", "見て", "please", "can you", "could you", "would you"]);
const CONTEXT_ONLY_PATTERN = /(?:です|でした|ます|ました|である|と思います|と考えています)$/;
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
  const source = terms.map(termToPatternSource).join("|");
  return new RegExp(`(?:${source})`, "i");
}

function termToPatternSource(term: string): string {
  const escaped = escapeRegExp(term).replace(/\\ /g, "\\s+");
  return /^[A-Za-z0-9][A-Za-z0-9\s_-]*$/.test(term) ? `\\b${escaped}\\b` : escaped;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Confidence = "high" | "medium" | "low" | "unknown";
type ProjectEvidence = "cwd" | "project_dir_name" | "unknown";
type ExpectedResultStrength = "explicit" | "implicit" | "none";
type PromptIntent = "approval" | "debugging" | "implementation" | "review" | "investigation" | "planning" | "writing" | "question" | "other";
type DeliverableType = "commit_message" | "report" | "summary" | "plan" | "review" | "template" | "code" | "unknown";
type ToolCategory = "exploration" | "editing" | "verification" | "git" | "other_bash" | "other";
type VerificationStatus = "verified" | "attempted_failed" | "attempted_unknown" | "not_attempted";

type ToolUse = {
  id: string;
  name: string;
  input: unknown;
};

type ToolResult = {
  toolUseId: string;
  isError: boolean;
  textExcerpt: string;
};

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
  filePath: string;
  projectDirName: string;
  events: NormalizedEvent[];
  projectPath: string | null;
  projectConfidence: Confidence;
  projectEvidence: ProjectEvidence;
  latestTimestampMs: number | null;
};

type CliOptions = {
  all: boolean;
  days: number;
  project: string | null;
  logRoot: string;
  out: string | null;
  maxSessions: number;
  maxEpisodes: number;
  maxExcerptChars: number;
  includeAssets: boolean;
};

type CollectionStats = {
  sessionFilesFound: number;
  sessionFilesScanned: number;
  linesRead: number;
  parseErrors: number;
  skippedMetaMessages: number;
  rawEventCounts: Record<string, number>;
  excludedUserEventCounts: Record<string, number>;
  nonConversationEvents: number;
  unknownEvents: number;
  redactionsApplied: number;
};

type PromptEpisode = {
  episode_id: string;
  session_id: string;
  timestamp: string | null;
  project: {
    path: string | null;
    name: string;
    confidence: Confidence;
    evidence: ProjectEvidence;
  };
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
  before_context: {
    previous_assistant_excerpt: string;
    previous_assistant_had_plan: boolean;
  };
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

type ProjectAggregate = {
  path: string;
  sessionIds: Set<string>;
  lastSeenMs: number | null;
};

type ProjectAsset = {
  project_path: string;
  project_name: string;
  seen_in_logs: boolean;
  session_count: number;
  last_seen_at: string | null;
  claude_md: {
    exists: boolean;
    paths: Array<{
      path: string;
      size_bytes: number;
      headings: string[];
      excerpt: string;
    }>;
  };
  skills: {
    exists: boolean;
    count: number;
    items: Array<{
      name: string;
      path: string;
      size_bytes: number;
      has_description: boolean;
      has_usage_guidance: boolean;
      excerpt: string;
    }>;
  };
};

type GlobalAsset = {
  config_root: string;
  claude_md: ProjectAsset["claude_md"];
  skills: ProjectAsset["skills"];
};

// -----------------------------------------------------------------------------
// CLI parsing
// -----------------------------------------------------------------------------

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    all: false,
    days: DEFAULT_DAYS,
    project: null,
    logRoot: process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
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
      case "--all":
        options.all = true;
        break;
      case "--days":
        options.days = readNumberOption(arg, next);
        i++;
        break;
      case "--project":
        options.project = readStringOption(arg, next);
        i++;
        break;
      case "--log-root":
        options.logRoot = expandHome(readStringOption(arg, next));
        i++;
        break;
      case "--out":
        options.out = readStringOption(arg, next);
        i++;
        break;
      case "--max-sessions":
        options.maxSessions = readNumberOption(arg, next);
        i++;
        break;
      case "--max-episodes":
        options.maxEpisodes = readNumberOption(arg, next);
        i++;
        break;
      case "--max-excerpt-chars":
        options.maxExcerptChars = readNumberOption(arg, next);
        i++;
        break;
      case "--include-assets":
        options.includeAssets = true;
        break;
      case "--no-assets":
        options.includeAssets = false;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  options.logRoot = expandHome(options.logRoot);
  return options;
}

function readStringOption(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readNumberOption(name: string, value: string | undefined): number {
  const parsed = Number(readStringOption(name, value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} requires a non-negative number`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  const help = `Usage: npx tsx collect.ts [options]

Options:
  --all                       Collect all available Claude Code logs
  --days <n>                  Collect logs from the last n days (default: 7)
  --project <name>            Filter projects by partial name/path match
  --log-root <path>           Claude config directory (default: CLAUDE_CONFIG_DIR or ~/.claude)
  --out <path>                Write JSON to file instead of stdout
  --max-sessions <n>          Maximum session files to scan (default: 50)
  --max-episodes <n>          Maximum Prompt Episodes to output (default: 200)
  --max-excerpt-chars <n>     Maximum excerpt length (default: 1200)
  --include-assets            Include current project/global CLAUDE.md and skills (default)
  --no-assets                 Skip current project/global asset discovery
`;
  console.log(help);
  process.exit(0);
}

// -----------------------------------------------------------------------------
// Path / time utilities
// -----------------------------------------------------------------------------

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function toIso(ms: number | null): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function isoToMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cutoffMs(options: CliOptions): number | null {
  if (options.all || options.days === 0) return null;
  return Date.now() - options.days * 24 * 60 * 60 * 1000;
}

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, "/");
}

function basenameSafe(input: string | null): string {
  if (!input) return "unknown";
  return path.basename(input) || "unknown";
}

async function pathExists(input: string): Promise<boolean> {
  try {
    await fs.access(input);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(input: string): Promise<boolean> {
  try {
    return (await fs.stat(input)).isDirectory();
  } catch {
    return false;
  }
}

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12);
}

// -----------------------------------------------------------------------------
// Redaction utilities
// -----------------------------------------------------------------------------

let redactionsApplied = 0;

function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.normalize("NFKC").replace(/[\uD800-\uDFFF]/g, "").trim();
}

function normalizeUserPromptText(input: string): string {
  let text = sanitizeText(input).replace(/\r\n?/g, "\n");
  text = removeInjectedXmlBlocks(text);
  return text
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function removeInjectedXmlBlocks(input: string): string {
  const injectedTags = [
    "ide_opened_file",
    "ide_selection",
    "local-command-caveat",
    "local-command-stdout",
    "system-reminder",
    "command-name",
    "command-message",
    "command-args",
  ];
  let text = input;
  for (const tag of injectedTags) {
    const escaped = escapeRegExp(tag);
    text = text.replace(new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}>`, "gi"), "\n");
  }
  return text;
}

function redactText(input: string, maxChars: number): string {
  let text = sanitizeText(input);
  const before = text;

  const home = os.homedir();
  const homeForward = normalizeSlashes(home);
  const escapedHome = escapeRegExp(home);
  const escapedHomeForward = escapeRegExp(homeForward);
  text = text.replace(new RegExp(escapedHome, "gi"), "<HOME>");
  text = normalizeSlashes(text).replace(new RegExp(escapedHomeForward, "gi"), "<HOME>");

  text = text.replace(EMAIL_PATTERN, "<EMAIL>");
  for (const [pattern, label] of SECRET_PATTERNS) {
    text = text.replace(pattern, `<SECRET:${label}>`);
  }

  if (text !== before) redactionsApplied++;
  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}... <TRUNCATED:${text.length - maxChars}_CHARS>`;
  }
  return text;
}

function redactPath(input: string | null, maxChars = DEFAULT_MAX_EXCERPT_CHARS): string | null {
  if (!input) return null;
  return redactText(normalizeSlashes(input), maxChars);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeRedactedPath(root: string, target: string): string {
  const relative = path.relative(root, target) || path.basename(target);
  return normalizeSlashes(relative);
}

// -----------------------------------------------------------------------------
// Claude Code log discovery
// -----------------------------------------------------------------------------

async function discoverSessionFiles(options: CliOptions, stats: CollectionStats): Promise<string[]> {
  const projectsDir = path.join(options.logRoot, "projects");
  if (!(await isDirectory(projectsDir))) return [];

  const cutoff = cutoffMs(options);
  const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
  const sessionFiles: Array<{ file: string; mtimeMs: number }> = [];

  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const projectDir = path.join(projectsDir, dirent.name);

    if (options.project && !dirent.name.toLowerCase().includes(options.project.toLowerCase())) {
      const decoded = decodeProjectDirName(dirent.name);
      if (!decoded || !decoded.toLowerCase().includes(options.project.toLowerCase())) continue;
    }

    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(projectDir, entry.name);
      const stat = await fs.stat(file);
      if (cutoff && stat.mtimeMs < cutoff) continue;
      sessionFiles.push({ file, mtimeMs: stat.mtimeMs });
    }
  }

  sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  stats.sessionFilesFound = sessionFiles.length;
  return sessionFiles.slice(0, options.maxSessions).map((item) => item.file);
}

function decodeProjectDirName(name: string): string | null {
  if (!name) return null;

  if (/^[A-Za-z]--/.test(name)) {
    const drive = name[0].toUpperCase();
    const rest = name.slice(3).replace(/-/g, path.sep);
    return `${drive}:${path.sep}${rest}`;
  }

  if (name.startsWith("-")) {
    return path.sep + name.slice(1).replace(/-/g, path.sep);
  }

  return null;
}

// -----------------------------------------------------------------------------
// JSONL parsing / message normalization
// -----------------------------------------------------------------------------

async function readSessionFile(filePath: string, options: CliOptions, stats: CollectionStats): Promise<SessionData> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const events: NormalizedEvent[] = [];
  const projectDirName = path.basename(path.dirname(filePath));

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    stats.linesRead++;

    let raw: any;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      stats.parseErrors++;
      continue;
    }

    const normalized = normalizeEvent(raw, options, stats);
    if (normalized) events.push(normalized);
  }

  const projectPath = inferProjectPath(events, projectDirName);
  const latestTimestampMs = latestMs(events.map((event) => event.timestampMs));

  return {
    id: path.basename(filePath, ".jsonl"),
    filePath,
    projectDirName,
    events,
    projectPath: projectPath.path,
    projectConfidence: projectPath.confidence,
    projectEvidence: projectPath.evidence,
    latestTimestampMs,
  };
}

function normalizeEvent(raw: any, options: CliOptions, stats: CollectionStats): NormalizedEvent | null {
  if (!raw || typeof raw !== "object") {
    stats.unknownEvents++;
    return null;
  }

  const rawType = String(raw.type || raw.message?.role || "unknown");
  incrementCount(stats.rawEventCounts, rawType);

  if (raw.isMeta) {
    stats.skippedMetaMessages++;
    return null;
  }

  const role: "user" | "assistant" | "other" = rawType === "user" ? "user" : rawType === "assistant" ? "assistant" : "other";
  const timestampMs = isoToMs(raw.timestamp) || (typeof raw.timestamp === "number" ? raw.timestamp : null);
  const timestamp = toIso(timestampMs);
  const cwd = typeof raw.cwd === "string" && raw.cwd ? raw.cwd : null;
  const content = raw.message?.content ?? raw.content;

  const toolUses = extractToolUses(content);
  const toolResults = extractToolResults(content, options.maxExcerptChars);
  const userText = role === "user" ? extractUserText(content) : "";
  const assistantText = role === "assistant" ? extractAssistantText(content) : "";
  const userPromptExclusion = role === "user" ? getUserPromptExclusionReason(userText) : null;
  const isActualUserPrompt = role === "user" && userPromptExclusion === null;

  if (role === "user" && userPromptExclusion) {
    incrementCount(stats.excludedUserEventCounts, userPromptExclusion);
  }

  if (role === "other") {
    if (rawType === "unknown") stats.unknownEvents++;
    else stats.nonConversationEvents++;
  }

  return {
    rawType,
    role,
    timestampMs,
    timestamp,
    cwd,
    userText,
    assistantText,
    toolUses,
    toolResults,
    isActualUserPrompt,
  };
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return normalizeUserPromptText(content);
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const typed = item as Record<string, unknown>;
    if (typed.type === "tool_result") continue;
    if (typed.type !== "text") continue;
    const text = normalizeUserPromptText(sanitizeText(typed.text));
    if (!text) continue;
    parts.push(text);
  }
  return normalizeUserPromptText(parts.join("\n"));
}

function extractAssistantText(content: unknown): string {
  if (typeof content === "string") return sanitizeText(content);
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const typed = item as Record<string, unknown>;
    if (typed.type !== "text") continue;
    const text = sanitizeText(typed.text);
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

function extractToolUses(content: unknown): ToolUse[] {
  if (!Array.isArray(content)) return [];
  const tools: ToolUse[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const typed = item as Record<string, unknown>;
    if (typed.type !== "tool_use") continue;
    tools.push({
      id: typeof typed.id === "string" ? typed.id : "",
      name: typeof typed.name === "string" ? typed.name : "unknown",
      input: typed.input,
    });
  }

  return tools;
}

function extractToolResults(content: unknown, maxChars: number): ToolResult[] {
  if (!Array.isArray(content)) return [];
  const results: ToolResult[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const typed = item as Record<string, unknown>;
    if (typed.type !== "tool_result") continue;
    results.push({
      toolUseId: typeof typed.tool_use_id === "string" ? typed.tool_use_id : "",
      isError: typed.is_error === true,
      textExcerpt: redactText(extractToolResultText(typed.content), Math.min(maxChars, 500)),
    });
  }

  return results;
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
          return String((item as Record<string, unknown>).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
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

function incrementCount(target: Record<string, number>, key: string): void {
  target[key] = (target[key] || 0) + 1;
}

// -----------------------------------------------------------------------------
// Prompt Episode builder
// -----------------------------------------------------------------------------

function buildEpisodes(sessions: SessionData[], options: CliOptions): PromptEpisode[] {
  const episodes: PromptEpisode[] = [];

  for (const session of sessions) {
    const userIndexes = session.events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.isActualUserPrompt);

    for (let turn = 0; turn < userIndexes.length; turn++) {
      if (episodes.length >= options.maxEpisodes) return episodes;

      const current = userIndexes[turn];
      const next = userIndexes[turn + 1] || null;
      const beforeEvents = session.events.slice(0, current.index);
      const afterEvents = session.events.slice(current.index + 1, next ? next.index : session.events.length);
      const previousAssistant = findPreviousAssistant(beforeEvents);
      const behavior = summarizeAfterBehavior(afterEvents);
      const finalAssistantText = findFinalAssistantText(afterEvents);
      const nextUserType = classifyNextUserPrompt(next?.event.userText || "");
      const projectPath = current.event.cwd || session.projectPath;
      const userText = current.event.userText;
      const promptSignals = analyzeUserPrompt(userText);

      episodes.push({
        episode_id: `${stableHash(session.id)}:turn-${turn + 1}`,
        session_id: stableHash(session.id),
        timestamp: current.event.timestamp,
        project: {
          path: redactPath(projectPath, options.maxExcerptChars),
          name: basenameSafe(projectPath),
          confidence: projectPath ? session.projectConfidence : "unknown",
          evidence: projectPath ? (current.event.cwd ? "cwd" : session.projectEvidence) : "unknown",
        },
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
        before_context: {
          previous_assistant_excerpt: redactText(previousAssistant, options.maxExcerptChars),
          previous_assistant_had_plan: PLAN_PATTERN.test(previousAssistant),
        },
        after_behavior: behavior,
        outcome: {
          assistant_final_excerpt: redactText(finalAssistantText, options.maxExcerptChars),
          mentions_not_verified: NOT_VERIFIED_PATTERN.test(finalAssistantText),
          ended_with_api_error: API_ERROR_PATTERN.test(finalAssistantText),
          ended_with_user_abort: USER_ABORT_PATTERN.test(finalAssistantText),
          ended_with_tool_error: behavior.bash_failures > 0 && !finalAssistantText,
          next_user_prompt_type: nextUserType,
        },
      });
    }
  }

  return episodes;
}

function findPreviousAssistant(events: NormalizedEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].assistantText) return events[i].assistantText;
  }
  return "";
}

function findFinalAssistantText(events: NormalizedEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].assistantText) return events[i].assistantText;
  }
  return "";
}

function summarizeAfterBehavior(events: NormalizedEvent[]): PromptEpisode["after_behavior"] {
  const toolCounts: Record<string, number> = {};
  const toolCategories: Record<ToolCategory, number> = {
    exploration: 0,
    editing: 0,
    verification: 0,
    git: 0,
    other_bash: 0,
    other: 0,
  };
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

      if (tool.name === "Bash") {
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
      if (resultFailed && tool?.name === "Bash") bashFailures++;
    }
  }

  const redactedBashCommands = uniqueValues(bashCommands).map((command) => redactText(command, 300)).slice(0, 20);
  const verificationStatus = determineVerificationStatus(hadVerificationCommand, verificationToolIds, verificationResultByToolId);

  return {
    tool_call_count: toolCallCount,
    tool_counts: toolCounts,
    tool_categories: toolCategories,
    first_edit_after_tool_calls: firstEditAfterToolCalls,
    bash_failures: bashFailures,
    repeated_bash_commands: repeatedValues(bashCommands).map((command) => redactText(command, 300)),
    bash_commands: redactedBashCommands,
    files_read: [...filesRead].map((file) => redactPath(file, 500) || file).slice(0, 50),
    files_edited: [...filesEdited].map((file) => redactPath(file, 500) || file).slice(0, 50),
    had_file_edit: hadFileEdit,
    had_verification_command: hadVerificationCommand,
    verification_status: verificationStatus,
  };
}

function analyzeUserPrompt(text: string): {
  normalizedText: string;
  promptIntent: PromptIntent;
  deliverableType: DeliverableType;
  looksLikeShortApproval: boolean;
  hasFileReference: boolean;
  hasErrorExcerpt: boolean;
  hasTaskGoal: boolean;
  expectedResultStrength: ExpectedResultStrength;
  expectedResultEvidence: string[];
  hasScopeLimit: boolean;
  hasOutputFormat: boolean;
  hasAcceptanceCriteria: boolean;
  hasReproductionSteps: boolean;
  hasRecentChangeContext: boolean;
  hasVerificationCommand: boolean;
} {
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
  if (looksLikeShortApproval(text)) return false;
  if (isStatusOnlyPrompt(text)) return false;
  if (isContextOnlyPrompt(text)) return false;
  return TASK_GOAL_PATTERN.test(text);
}

function isStatusOnlyPrompt(text: string): boolean {
  return STATUS_UPDATE_PATTERN.test(text) && !STATUS_FOLLOWUP_REQUEST_PATTERN.test(text);
}

function isContextOnlyPrompt(text: string): boolean {
  if (!CONTEXT_ONLY_PATTERN.test(text)) return false;
  if (STATUS_FOLLOWUP_REQUEST_PATTERN.test(text)) return false;
  if (/[?？]/.test(text)) return false;
  return !/(?:ください|してほしい|したい|考えて|レビューして|調査して|分析して|作成して|実装して|修正して|追加して|変更して|更新して|削除して|マージして|報告して|提示して|抽出して|please|can you|could you|would you)/i.test(text);
}

function classifyPromptIntent(text: string): PromptIntent {
  if (looksLikeShortApproval(text)) return "approval";
  if (isStatusOnlyPrompt(text)) return "other";
  if (isContextOnlyPrompt(text)) return "other";
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
  for (const [type, pattern] of DELIVERABLE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "unknown";
}

function categorizeToolUse(tool: ToolUse): ToolCategory {
  if (["Read", "Grep", "Glob", "LS"].includes(tool.name)) return "exploration";
  if (TOOL_EDIT_NAMES.has(tool.name)) return "editing";
  if (tool.name !== "Bash") return "other";

  const command = extractBashCommand(tool.input);
  if (VERIFICATION_COMMAND_PATTERN.test(command)) return "verification";
  if (/^\s*git\s+/i.test(command)) return "git";
  return "other_bash";
}

function extractReadFiles(tool: ToolUse): string[] {
  if (!tool.input || typeof tool.input !== "object") return [];
  const input = tool.input as Record<string, unknown>;
  const paths: string[] = [];
  if (tool.name === "Read" && typeof input.file_path === "string") paths.push(input.file_path);
  if (tool.name === "Grep" && typeof input.path === "string") paths.push(input.path);
  if (tool.name === "Glob" && typeof input.path === "string") paths.push(input.path);
  if (tool.name === "LS" && typeof input.path === "string") paths.push(input.path);
  return paths;
}

function extractEditedFiles(tool: ToolUse): string[] {
  if (!tool.input || typeof tool.input !== "object") return [];
  const input = tool.input as Record<string, unknown>;
  if (TOOL_EDIT_NAMES.has(tool.name) && typeof input.file_path === "string") return [input.file_path];
  return [];
}

function determineVerificationStatus(hadVerificationCommand: boolean, verificationToolIds: Set<string>, results: Map<string, boolean>): VerificationStatus {
  if (!hadVerificationCommand) return "not_attempted";
  if ([...verificationToolIds].some((id) => results.get(id) === true)) return "verified";
  if ([...verificationToolIds].some((id) => results.get(id) === false)) return "attempted_failed";
  return "attempted_unknown";
}

function toolResultIndicatesFailure(text: string): boolean {
  return TOOL_RESULT_FAILURE_PATTERN.test(text);
}

function extractBashCommand(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command.trim() : "";
}

function repeatedValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function looksLikeShortApproval(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 40 || trimmed.split(/\s+/).length > 5) return false;
  return /^(?:ok|yes|y|お願いします|進めて|それで|はい|頼む|実行して|continue|go ahead|proceed|sounds good)$/i.test(trimmed);
}

function classifyNextUserPrompt(text: string): "correction" | "satisfied" | "follow_up" | "none" {
  const trimmed = text.trim();
  if (!trimmed) return "none";
  if (CORRECTION_PATTERN.test(trimmed)) return "correction";
  if (SATISFIED_PATTERN.test(trimmed)) return "satisfied";
  return "follow_up";
}

// -----------------------------------------------------------------------------
// Project path extraction
// -----------------------------------------------------------------------------

function inferProjectPath(events: NormalizedEvent[], projectDirName: string): { path: string | null; confidence: Confidence; evidence: ProjectEvidence } {
  const cwdCounts = new Map<string, number>();
  for (const event of events) {
    if (event.cwd) cwdCounts.set(event.cwd, (cwdCounts.get(event.cwd) || 0) + 1);
  }

  const mostCommonCwd = [...cwdCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (mostCommonCwd) return { path: mostCommonCwd, confidence: "high", evidence: "cwd" };

  const decoded = decodeProjectDirName(projectDirName);
  if (decoded) return { path: decoded, confidence: "medium", evidence: "project_dir_name" };

  return { path: null, confidence: "unknown", evidence: "unknown" };
}

function aggregateProjects(sessions: SessionData[]): Map<string, ProjectAggregate> {
  const projects = new Map<string, ProjectAggregate>();

  for (const session of sessions) {
    if (!session.projectPath) continue;
    const existing = projects.get(session.projectPath) || {
      path: session.projectPath,
      sessionIds: new Set<string>(),
      lastSeenMs: null,
    };
    existing.sessionIds.add(session.id);
    existing.lastSeenMs = Math.max(existing.lastSeenMs || 0, session.latestTimestampMs || 0) || existing.lastSeenMs;
    projects.set(session.projectPath, existing);
  }

  return projects;
}

function latestMs(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return valid.length ? Math.max(...valid) : null;
}

// -----------------------------------------------------------------------------
// CLAUDE.md / SKILLS discovery
// -----------------------------------------------------------------------------

async function collectProjectAssets(projects: Map<string, ProjectAggregate>, options: CliOptions): Promise<ProjectAsset[]> {
  const assets: ProjectAsset[] = [];

  for (const project of projects.values()) {
    if (!(await isDirectory(project.path))) continue;
    if (options.project && !project.path.toLowerCase().includes(options.project.toLowerCase())) continue;

    const claudeFiles = await collectClaudeMdFiles(project.path, options.maxExcerptChars);
    const skills = await collectSkillFiles(project.path, options.maxExcerptChars);

    assets.push({
      project_path: redactPath(project.path, options.maxExcerptChars) || "unknown",
      project_name: basenameSafe(project.path),
      seen_in_logs: true,
      session_count: project.sessionIds.size,
      last_seen_at: toIso(project.lastSeenMs),
      claude_md: {
        exists: claudeFiles.length > 0,
        paths: claudeFiles,
      },
      skills: {
        exists: skills.length > 0,
        count: skills.length,
        items: skills,
      },
    });
  }

  assets.sort((a, b) => b.session_count - a.session_count || a.project_name.localeCompare(b.project_name));
  return assets;
}

async function collectGlobalAssets(options: CliOptions): Promise<GlobalAsset> {
  const configRoot = options.logRoot;
  const claudeFiles = await collectClaudeMdFilesFromCandidates(configRoot, [
    path.join(configRoot, "CLAUDE.md"),
    path.join(configRoot, ".claude", "CLAUDE.md"),
  ], options.maxExcerptChars);
  const skills = await collectSkillFilesFromRoots(configRoot, [
    path.join(configRoot, "skills"),
    path.join(configRoot, ".claude", "skills"),
  ], options.maxExcerptChars);

  return {
    config_root: redactPath(configRoot, options.maxExcerptChars) || "unknown",
    claude_md: {
      exists: claudeFiles.length > 0,
      paths: claudeFiles,
    },
    skills: {
      exists: skills.length > 0,
      count: skills.length,
      items: skills,
    },
  };
}

async function collectClaudeMdFiles(projectPath: string, maxChars: number): Promise<ProjectAsset["claude_md"]["paths"]> {
  const candidates = [path.join(projectPath, "CLAUDE.md"), path.join(projectPath, ".claude", "CLAUDE.md")];
  return collectClaudeMdFilesFromCandidates(projectPath, candidates, maxChars);
}

async function collectClaudeMdFilesFromCandidates(rootPath: string, candidates: string[], maxChars: number): Promise<ProjectAsset["claude_md"]["paths"]> {
  const files: ProjectAsset["claude_md"]["paths"] = [];

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue;
    try {
      const stat = await fs.stat(candidate);
      const text = await fs.readFile(candidate, "utf8");
      files.push({
        path: relativeRedactedPath(rootPath, candidate),
        size_bytes: stat.size,
        headings: extractHeadings(text),
        excerpt: redactText(text, maxChars),
      });
    } catch {
      continue;
    }
  }

  return files;
}

async function collectSkillFiles(projectPath: string, maxChars: number): Promise<ProjectAsset["skills"]["items"]> {
  const roots = [path.join(projectPath, ".claude", "skills"), path.join(projectPath, "skills")];
  return collectSkillFilesFromRoots(projectPath, roots, maxChars);
}

async function collectSkillFilesFromRoots(rootPath: string, roots: string[], maxChars: number): Promise<ProjectAsset["skills"]["items"]> {
  const items: ProjectAsset["skills"]["items"] = [];

  for (const root of roots) {
    if (!(await isDirectory(root))) continue;
    const entries = await fs.readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(root, entry.name, "SKILL.md");
      if (!(await pathExists(skillPath))) continue;
      try {
        const stat = await fs.stat(skillPath);
        const text = await fs.readFile(skillPath, "utf8");
        items.push({
          name: entry.name,
          path: relativeRedactedPath(rootPath, skillPath),
          size_bytes: stat.size,
          has_description: /description\s*:/i.test(text),
          has_usage_guidance: /(?:use this skill when|workflow|when to use|ワークフロー|ステップ|手順|使い方|使用条件|基本方針|対象シナリオ)/i.test(text),
          excerpt: redactText(text, maxChars),
        });
      } catch {
        continue;
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

function extractHeadings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading))
    .slice(0, 20);
}

// -----------------------------------------------------------------------------
// Output builder
// -----------------------------------------------------------------------------

async function buildOutput(options: CliOptions): Promise<unknown> {
  const stats: CollectionStats = {
    sessionFilesFound: 0,
    sessionFilesScanned: 0,
    linesRead: 0,
    parseErrors: 0,
    skippedMetaMessages: 0,
    rawEventCounts: {},
    excludedUserEventCounts: {},
    nonConversationEvents: 0,
    unknownEvents: 0,
    redactionsApplied: 0,
  };

  const sessionFiles = await discoverSessionFiles(options, stats);
  const sessions: SessionData[] = [];

  for (const file of sessionFiles) {
    try {
      const session = await readSessionFile(file, options, stats);
      if (session.events.length > 0) sessions.push(session);
      stats.sessionFilesScanned++;
    } catch {
      stats.parseErrors++;
    }
  }

  const episodes = buildEpisodes(sessions, options);
  const projects = aggregateProjects(sessions);
  const assets = options.includeAssets ? await collectProjectAssets(projects, options) : [];
  const globalAssets = options.includeAssets ? await collectGlobalAssets(options) : null;
  stats.redactionsApplied = redactionsApplied;

  return {
    meta: {
      generated_at: new Date().toISOString(),
      collector: "claude-usage-review/scripts/collect.ts",
      scope: options.all || options.days === 0 ? "all" : `last_${options.days}_days`,
      log_root: redactPath(options.logRoot),
      project_filter: options.project,
      limits: {
        max_sessions: options.maxSessions,
        max_episodes: options.maxEpisodes,
        max_excerpt_chars: options.maxExcerptChars,
      },
      stats,
    },
    log_analysis: {
      note: "Prompt Episodes are derived from historical Claude Code logs.",
      sessions_scanned: sessions.length,
      episodes_count: episodes.length,
      episodes,
    },
    project_assets: {
      note: "Project asset analysis is based on current files in projects seen in the logs. It is not proof that those files influenced historical sessions.",
      projects_count: assets.length,
      projects: assets,
    },
    global_assets: {
      note: "Global asset analysis is based on current files in the Claude Code config directory. It is not proof that those files influenced historical sessions.",
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

// -----------------------------------------------------------------------------
// main()
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const output = await buildOutput(options);
  await writeOutput(output, options.out);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
