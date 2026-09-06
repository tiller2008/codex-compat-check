// probe.mjs — 无模型、无密钥的 codex app-server 协议探针。
// 复刻 dsh-subagent-codex 的握手：initialize → initialized → thread/start。
// 任一握手方法名/参数在新版 codex 上不兼容 → 进程退出码 1。
//
// ⚠️ 维护注意：下面的握手参数是从 dsh-subagent-codex@0.1.2-rc.1 源码抄出来的。
// 若 subagent-codex 升级导致协议参数变化，需同步更新这里的字段。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);

let pkgPath;
let codexBin;
try {
  pkgPath = require.resolve("@openai/codex/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.codex;
  if (!binRel) {
    console.error("PROBE FAIL: @openai/codex package.json 缺少 bin.codex");
    process.exit(1);
  }
  codexBin = resolve(dirname(pkgPath), binRel);
  console.log(`probe: @openai/codex@${pkg.version} (${codexBin})`);
} catch (e) {
  console.error("PROBE FAIL: 无法解析 @openai/codex（是否已 npm install？）:", e.message);
  process.exit(1);
}

const child = spawn(process.execPath, [codexBin, "app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
let nextId = 1;
const pending = new Map();

function request(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

child.stdout.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  }
});
child.stderr.on("data", (c) => process.stderr.write(c));

const timeout = setTimeout(() => {
  console.error("PROBE FAIL: 握手超时");
  child.kill();
  process.exit(1);
}, 30000);

try {
  await request("initialize", {
    clientInfo: { name: "deepseek-harness", title: "DeepSeek Harness", version: "0.0.1" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  console.log("  initialize OK");
  notify("initialized");

  const thread = await request("thread/start", {
    cwd: process.cwd(),
    ephemeral: true,
    approvalPolicy: "never",
  });
  console.log("  thread/start OK, thread id:", thread?.thread?.id ?? "(unknown)");
  console.log("PROBE PASS");
  clearTimeout(timeout);
  child.kill();
  process.exit(0);
} catch (e) {
  console.error("PROBE FAIL:", e.message);
  clearTimeout(timeout);
  child.kill();
  process.exit(1);
}
