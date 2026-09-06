# codex-compat-check

每天自动检查 `@openai/codex@latest` 是否仍与 `dsh-subagent-codex` 的 app-server 协议兼容，结果邮件通知。
容器默认「跟随 latest」，所以大多数时候无需操作；只有收到 ❌ 邮件才需手动 pin。

## 工作原理

- `probe.mjs`：**无模型、无密钥**地复刻 subagent-codex 的握手（`initialize → initialized → thread/start`）。
- workflow 每天跑一次：查 codex/subagent 最新版 → 装 codex → 跑探针 → 邮件。
- **只有 codex 版本变化时才发「通过」邮件**（避免每天刷屏）；**失败必发**。
- 探针通过后自动把新版本写回 `last-good.txt` 并提交，作为下次对比基线。

## 部署步骤

1. 在 GitHub 新建空仓库（如 `codex-compat-check`），把本目录内容推上去（本目录本身就是一个完整 repo，可直接 `git init`）。
2. 仓库 Settings → Actions → General → Workflow permissions → 选 **Read and write permissions**（让 workflow 能自动提交 `last-good.txt`）。
3. 仓库 Settings → Secrets and variables → Actions → 添加 6 个 secret（QQ/163 邮箱的例子见下）：
   - `SMTP_HOST`：如 `smtp.qq.com` / `smtp.163.com`
   - `SMTP_PORT`：`465`（SSL；若用 587 需把 workflow 里 `secure: true` 改成 `false`）
   - `SMTP_USERNAME`：邮箱账号，如 `12345@qq.com`
   - `SMTP_PASSWORD`：**授权码**（不是登录密码，见邮箱设置）
   - `MAIL_TO`：收件邮箱
   - `MAIL_FROM`：发件人，如 `codex-check@qq.com`

   QQ 邮箱授权码：网页登录 QQ 邮箱 → 设置 → 账户 → 开启「SMTP 服务」→ 生成授权码。
   163 同理（设置 → POP3/SMTP/IMAP → 开启并获取授权码）。
4. Actions → codex-compat-check → Run workflow 手动跑一次，验证整条链路（探针 + 邮件）。

## 邮件含义

- ✅「协议兼容，无需操作」→ codex 新版握手通过。容器默认跟随 latest，下次重启自动用上，**无需任何手动操作**。
- ❌「检测失败，建议 pin」→ codex 新版协议和 subagent 对不上。因为容器默认跟随 latest，请**立即**在生产 `docker-compose.yml` 设 `DSH_CODEX_OVERRIDE_VERSION=<邮件里的 last 版本>` 冻结，等 `dsh-subagent-codex` 上游适配。

## 维护注意

- `probe.mjs` 里的握手参数是从 `dsh-subagent-codex@0.1.2-rc.1` 源码抄的。若 subagent-codex 升级导致协议参数变化，
  需同步更新 `probe.mjs` 里的 `initialize`/`thread/start` 字段（邮件正文会带上当时的 subagent 版本，方便对照）。
- `last-good.txt` 初始为 `0.149.1`（subagent 当前自带的已知可用版本）。

## 本仓库与 dsh 容器零耦合

本仓库不读、不拷、不依赖你的 dsh 容器/宿主机任何内容；探针在 GitHub 云端自装 codex 并测试，
只借用了「subagent 期望的握手协议」这一知识（已硬编码进 `probe.mjs`）。
