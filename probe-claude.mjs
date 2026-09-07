// probe-claude.mjs — 无模型、无密钥的 Claude Agent SDK 兼容性探针。
// 校验 dsh-subagent-claude-code 依赖的 SDK 契约面是否在新版仍存在：
//   1) query 函数可导入；
//   2) resolveSettings() 可无密钥调用（验证 SDK 主包能加载、配置解析引擎未坏）；
//   3) query options 用到的字段在新版 sdk.d.ts 类型里仍存在。
// 任一不满足 → 进程退出码 1。
//
// ⚠️ 维护注意：下面的字段清单是从 dsh-subagent-claude-code@0.1.2-rc.1 的
// claudeQueryOptions() 源码抄出来的。若 subagent-claude-code 升级导致它调用
// query 的参数变化，需同步更新 REQUIRED_OPTIONS。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

// --- 1) 解析 SDK 主包，拿版本与 sdk.d.ts 路径 ---
// 注意：SDK 用 package.json 的 "exports" 限制了 subpath（./package.json 不可访问），
// 因此从主入口（main: sdk.mjs）反向定位包目录，再读同目录的 package.json 与 sdk.d.ts。
let sdkRoot;
let sdkVersion;
try {
  const sdkMain = require.resolve("@anthropic-ai/claude-agent-sdk");
  sdkRoot = dirname(sdkMain);
  const pkg = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8"));
  sdkVersion = pkg.version;
  console.log(`probe-claude: @anthropic-ai/claude-agent-sdk@${sdkVersion}`);
} catch (e) {
  console.error("PROBE FAIL: 无法解析 @anthropic-ai/claude-agent-sdk（是否已 npm install？）:", e.message);
  process.exit(1);
}

const sdkDts = resolve(sdkRoot, "sdk.d.ts");
let dtsText = "";
try {
  dtsText = readFileSync(sdkDts, "utf8");
} catch (e) {
  console.error("PROBE FAIL: 无法读取 sdk.d.ts:", e.message);
  process.exit(1);
}

// dsh-subagent-claude-code 的 claudeQueryOptions() 用到的 query options 字段。
// 若缺字段，说明 SDK 主版本发生了破坏性变更。
const REQUIRED_OPTIONS = [
  "abortController",
  "cwd",
  "disallowedTools",
  "env",
  "onElicitation",
  "onUserDialog",
  "permissionMode",
  "persistSession",
  "spawnClaudeCodeProcess",
  "supportedDialogKinds",
  "canUseTool",
  "allowDangerouslySkipPermissions",
];

// --- 2) query 可导入 ---
let queryFn;
try {
  const sdk = await import(`@anthropic-ai/claude-agent-sdk`);
  queryFn = sdk.query;
  if (typeof queryFn !== "function") {
    console.error("PROBE FAIL: @anthropic-ai/claude-agent-sdk 未导出 query 函数");
    process.exit(1);
  }
  console.log("  query 可导入 OK");
} catch (e) {
  console.error("PROBE FAIL: import query 失败:", e.message);
  process.exit(1);
}

// --- 3) resolveSettings() 可无密钥调用 ---
try {
  const sdk = await import(`@anthropic-ai/claude-agent-sdk`);
  if (typeof sdk.resolveSettings === "function") {
    await sdk.resolveSettings({ cwd: process.cwd() });
    console.log("  resolveSettings() 无密钥调用 OK");
  } else {
    console.error("PROBE FAIL: 未导出 resolveSettings 函数");
    process.exit(1);
  }
} catch (e) {
  console.error("PROBE FAIL: resolveSettings() 调用失败:", e.message);
  process.exit(1);
}

// --- 4) 校验 query options 字段仍在 sdk.d.ts 里 ---
const missing = [];
for (const field of REQUIRED_OPTIONS) {
  // 匹配类型声明里的 "field?:" 或 "field:"（避免误匹配到注释/字符串）
  const re = new RegExp(`\\b${field}\\??\\s*:`);
  if (!re.test(dtsText)) {
    missing.push(field);
  }
}
if (missing.length > 0) {
  console.error(`PROBE FAIL: SDK 类型里缺失这些 query options 字段: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`  query options 契约面完整 (${REQUIRED_OPTIONS.length} 字段)`);

console.log("PROBE PASS");
process.exit(0);
