# subagent-compat-check

每天自动检查 `@openai/codex@latest` 与 `@anthropic-ai/claude-agent-sdk@latest` 是否仍与对应的 dsh subagent 提供方兼容，结果邮件通知。
容器默认「跟随 latest」，所以大多数时候无需操作；只有收到 ❌ 邮件才需手动 pin。

## 工作原理

- `probe.mjs`：**无模型、无密钥**地复刻 subagent-codex 的 app-server 握手（`initialize → initialized → thread/start`）。
- `probe-claude.mjs`：**无模型、无密钥**地校验 subagent-claude-code 依赖的 Agent SDK 契约面（`query` 可导入、`resolveSettings()` 可调用、query options 字段在 `sdk.d.ts` 里完整）。
- workflow 每天跑一次：查 codex/claude/subagent 最新版 → 装两个包 → 各跑各的探针 → 邮件。
- **两个探针完全独立、互不干扰**：codex 探针通过就推进 codex 的 last-good，claude 探针失败就保持 claude 旧版，反之亦然。
- 探针通过后自动把新版本写回 `last-good-codex.txt` / `last-good-claude.txt` 并提交，作为下次对比基线。

## 互不干扰的版本推进逻辑

| codex 探针 | claude 探针 | 结果 |
|---|---|---|
| ✅ 通过 | ✅ 通过 | 两个 last-good 都推进到最新 |
| ✅ 通过 | ❌ 失败 | codex 推进到最新，claude 保持旧版 |
| ❌ 失败 | ✅ 通过 | claude 推进到最新，codex 保持旧版 |
| ❌ 失败 | ❌ 失败 | 两个都保持旧版 |

实现上：两个探针 step 用 `continue-on-error: true`，各自独立判断 `outcome` 决定是否更新对应 last-good 文件，互不阻断。

## 部署步骤

1. 在 GitHub 新建空仓库（如 `subagent-compat-check`），把本目录内容推上去（本目录本身就是一个完整 repo，可直接 `git init`）。
2. 仓库 Settings → Actions → General → Workflow permissions → 选 **Read and write permissions**（让 workflow 能自动提交 last-good 文件）。
3. 仓库 Settings → Secrets and variables → Actions → 添加 6 个 secret（QQ/163 邮箱的例子见下）：
   - `SMTP_HOST`：如 `smtp.qq.com` / `smtp.163.com`
   - `SMTP_PORT`：`465`（SSL；若用 587 需把 workflow 里 `secure: true` 改成 `false`）
   - `SMTP_USERNAME`：邮箱账号，如 `12345@qq.com`
   - `SMTP_PASSWORD`：**授权码**（不是登录密码，见邮箱设置）
   - `MAIL_TO`：收件邮箱
   - `MAIL_FROM`：发件人，如 `subagent-check@qq.com`

   QQ 邮箱授权码：网页登录 QQ 邮箱 → 设置 → 账户 → 开启「SMTP 服务」→ 生成授权码。
   163 同理（设置 → POP3/SMTP/IMAP → 开启并获取授权码）。
4. Actions → subagent-compat-check → Run workflow 手动跑一次，验证整条链路（探针 + 邮件）。

## 邮件含义

- ✅「兼容，无需操作」→ codex/claude 新版都通过。容器默认跟随 latest，下次重启自动用上，**无需任何手动操作**。
- ❌「兼容检测有失败」→ 邮件里会写明哪个探针失败、哪个保持旧版。失败的项请**立即**在生产 pin 到邮件里的 last-good 版本，等对应 subagent 上游适配。

## 维护注意

- `probe.mjs` 里的握手参数是从 `dsh-subagent-codex@0.1.2-rc.1` 源码抄的。若 subagent-codex 升级导致协议参数变化，需同步更新 `probe.mjs` 里的 `initialize`/`thread/start` 字段。
- `probe-claude.mjs` 里的 `REQUIRED_OPTIONS` 是从 `dsh-subagent-claude-code@0.1.2-rc.1` 的 `claudeQueryOptions()` 源码抄的。若 subagent-claude-code 升级导致它调用 query 的参数变化，需同步更新该字段清单。
- `last-good-codex.txt` 初始沿用旧 `last-good.txt`（`0.153.4`，若不存在回落 `0.149.1`）；`last-good-claude.txt` 初始 `0.3.241`（subagent 当前锁定的已知可用版本）。

## 本仓库与 dsh 容器零耦合

本仓库不读、不拷、不依赖你的 dsh 容器/宿主机任何内容；探针在 GitHub 云端自装 codex 与 claude SDK 并测试，
只借用了「subagent 期望的握手协议 / SDK 契约面」这一知识（已硬编码进两个 probe 文件）。
