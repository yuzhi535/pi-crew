# pi-crew v0.2.20 — Kết quả khảo sát và phân tích

**Ngày:** 2026-05-19  
**Môi trường:** linux/x64, Node v22.22.0, Pi CLI v0.75.3  
**Model:** zai/glm-5.1 (planner, executor, test-engineer), minimax/MiniMax-M2.7-highspeed (explorer, analyst, reviewer, verifier, writer, critic)  
**pi-crew version:** 0.2.20

---

## 1. Tổng quan kiến trúc pi-crew

### 1.1 Cấu trúc source code

```
pi-crew/src/
├── adapters/          — Adapter cho các bên ngoài
├── agents/            — Agent discovery & config (10 agents)
├── config/            — Configuration, defaults, drift detection
├── extension/         — Pi extension registration
├── hooks/             — Lifecycle hooks (before_run_start, before_task_start, task_result, etc.)
├── observability/     — Metrics, correlation, exporters (OTLP, Prometheus)
├── prompt/            — Prompt runtime & pipeline
├── runtime/           — Core runtime (~30+ files)
│   ├── async-runner.ts      — Background process spawning với jiti loader
│   ├── background-runner.ts — Background entry point, team execution
│   ├── child-pi.ts          — Child Pi process lifecycle, stdout capture, timeout
│   ├── child-pi-pool.ts     — Warm pool skeleton (disabled, size=0)
│   ├── live-session-runtime.ts — Live-session (tái sử dụng parent Pi)
│   ├── team-runner.ts       — Main team run orchestrator
│   ├── worker-heartbeat.ts  — Heartbeat state tracking
│   ├── worker-startup.ts    — Startup failure classification
│   ├── pi-spawn.ts          — Pi binary resolution & spawn command
│   ├── pi-args.ts           — Build args cho child Pi workers
│   ├── runtime-resolver.ts  — Resolve live-session vs child-process
│   ├── crash-recovery.ts    — Crash recovery logic
│   ├── deadletter.ts        — Dead letter queue
│   └── ...
├── schema/            — Config & team-tool schema validation
├── skills/            — Built-in skills
├── state/             — State store, manifests, event logs
├── subagents/         — Subagent index, spawn, manager
├── teams/             — Team discovery (6 teams)
├── types/             — Shared TypeScript types
├── ui/                — TUI: widgets, overlays, dashboard, powerbar
├── utils/             — Utilities (sleep, shell resolve, redaction, env-filter)
├── workflows/         — Workflow discovery (6 workflows)
└── worktree/          — Git worktree isolation
```

### 1.2 Resource inventory

| Resource | Count | Chi tiết |
|---|---|---|
| **Teams** | 6 | default, fast-fix, implementation, parallel-research, research, review |
| **Workflows** | 6 | default, fast-fix, implementation, parallel-research, research, review |
| **Agents** | 10 | explorer, planner, analyst, critic, executor, reviewer, security-reviewer, test-engineer, verifier, writer |
| **Skills** | 27 | async-worker-recovery, child-pi-spawning, orchestration, systematic-debugging, verification-before-done, ... |
| **Hooks** | 5+ | before_run_start, before_task_start, before_retry, task_result, ... |

### 1.3 Runtime modes

pi-crew hỗ trợ 2 runtime modes:

| Mode | Mô tả | Ưu điểm | Nhược điểm |
|---|---|---|---|
| **live-session** | Tái sử dụng Pi session hiện tại | Nhanh, share provider connection | Không chạy được async/background |
| **child-process** | Spawn Pi process mới | Chạy được background/async | Cần provider connection riêng |

**Runtime resolution flow:**
```
team action='run' + async=true
  → runtime-resolver.ts: resolveCrewRuntime()
  → live-session available? NO (background cannot use live-session)
  → Fallback: child-process
  → spawn new Pi via jiti loader
```

---

## 2. Kết quả test toàn diện

### 2.1 Bảng tổng hợp

| Category | Tests | Pass | Fail | Partial |
|---|---|---|---|---|
| Resource Discovery (list, get, recommend) | 5 | ✅ 5 | 0 | 0 |
| Subagent Lifecycle (Agent, crew_agent) | 4 | 0 | ❌ 4 | 0 |
| Team Run Lifecycle (run, cancel, retry) | 4 | ✅ 1 | ❌ 2 | ⚠️ 1 |
| Planning (plan) | 1 | ✅ 1 | 0 | 0 |
| State Management (status, events, artifacts, summary, prune) | 6 | ✅ 6 | 0 | 0 |
| Diagnostics (doctor, validate, help) | 3 | ✅ 3 | 0 | 0 |
| Portability (export, import) | 2 | ✅ 2 | 0 | 0 |
| Configuration (settings, autonomy) | 2 | ✅ 2 | 0 | 0 |
| **Tổng** | **27** | **20** | **6** | **1** |

### 2.2 Chi tiết từng test

#### ✅ Resource Discovery — 5/5 PASS

| Test | Input | Output | Kết quả |
|---|---|---|---|
| `team list` | List all resources | 6 teams, 6 workflows, 10 agents | ✅ |
| `team get` team | Get team=default | 4 roles (explorer→planner→executor→verifier) | ✅ |
| `team get` workflow | Get workflow for implementation | Implementation workflow steps | ✅ |
| `team get` agent | Get agent=explorer | Full profile: model, description, instructions | ✅ |
| `team recommend` | goal="test all features" | Recommended implementation team, high confidence | ✅ |

#### ✅ Diagnostics — 3/3 PASS

| Test | Input | Output | Kết quả |
|---|---|---|---|
| `team doctor` | Full diagnostics | 17/17 checks OK (runtime, filesystem, discovery, validation, drift, schema, async, worktrees) | ✅ |
| `team validate` | Validate all resources | 10 agents, 6 teams, 6 workflows, 0 issues | ✅ |
| `team help` | Show help | Full command reference (core, inspection, maintenance, portability, diagnostics) | ✅ |

Doctor checks chi tiết:
- Runtime: cwd, platform, node, pi, git, config, model — all OK
- Filesystem: user state, project state, artifacts — all OK
- Discovery: 10 agents, 6 teams, 6 workflows, 10 model hints — all OK
- Drift: no config drift detected
- Schema: strict-provider schema compatible
- Async: fs.watch with polling fallback, completion notifications enabled
- Worktrees: leader repository OK, dirty worktrees preserved policy

#### ✅ State Management — 6/6 PASS

| Test | Input | Output | Kết quả |
|---|---|---|---|
| `team status` | Check run state | Detailed: task graph, events, artifacts, policy decisions | ✅ |
| `team events` | Get event log | 20+ events từ run.created → task.failed với timestamps | ✅ |
| `team artifacts` | List artifacts | 14 artifacts (prompts, results, metadata, logs, shared) | ✅ |
| `team summary` | Run overview | Status, goal, tasks, usage summary | ✅ |
| `team prune` | keep=2, confirm=true | 9 runs pruned, 2 kept, audit trail in prune.jsonl | ✅ |
| `team worktrees` | Without runId | Correctly required runId parameter | ✅ |

#### ✅ Portability — 2/2 PASS

| Test | Input | Output | Kết quả |
|---|---|---|---|
| `team export` | Export completed run | run-export.json + run-export.md created | ✅ |
| `team import` | Import exported bundle | Bundle imported to .crew/imports/ with README.md | ✅ |

#### ✅ Configuration — 2/2 PASS

| Test | Input | Output | Kết quả |
|---|---|---|---|
| `team settings` | Show effective settings | Complete: agent overrides, UI config, autonomous mode | ✅ |
| `team autonomy` | Show autonomy profile | Profile=suggested, enabled=true, inject policy=true | ✅ |

#### ✅ Planning — 1/1 PASS

| Test | Input | Output | Kết quả |
|---|---|---|---|
| `team plan` | goal="Add health-check endpoint" | 4-step plan: explore → plan → execute → verify | ✅ |

#### ❌ Subagent Lifecycle — 0/4 FAIL

| Test | Agent ID | Type | Duration | Output | Kết quả |
|---|---|---|---|---|---|
| Agent(explorer) | agent_mpc423rq_1 | explorer | 305s | Empty | ❌ |
| Agent(planner) | agent_mpc423rv_2 | planner | 305s | Empty | ❌ |
| Agent(analyst) | agent_mpc423rw_3 | analyst | 305s | Empty | ❌ |
| crew_agent(explorer) | agent_mpc423rw_4 | explorer | 305s | Empty | ❌ |

Tất cả đều: spawn thành công (PID tồn tại) → zero output → 305s heartbeat timeout → failed.

#### ❌ Team Run Lifecycle — 1 PASS, 2 FAIL, 1 PARTIAL

| Test | Team | Runtime | Kết quả | Chi tiết |
|---|---|---|---|---|
| implementation async | implementation | child-process | ❌ FAIL | 01_assess heartbeat dead after 300s |
| `team retry` | — | — | ✅ PASS | Task re-queued successfully |
| fast-fix foreground | fast-fix | live-session | ⚠️ PARTIAL | 01_explore completed, run cancelled before execute |
| `team cancel` | — | — | ✅ PASS | Run successfully cancelled |

---

## 3. Vấn đề nghiêm trọng: `pi --print` bị treo

### 3.1 Mô tả

**Tất cả 6 background worker failures đều có cùng root cause:** `pi --print` (non-interactive mode) bị treo vô thời hạn.

### 3.2 Reproduce

```bash
$ timeout 10 pi --print "say hi"
[context-mode] WARNING: skipping MCP bridge — CONTEXT_MODE_BRIDGE_DEPTH=1 indicates recursion
# ... hangs indefinitely ...
EXIT_CODE: 124  (timeout)
```

Kết quả: **100% reproducible**. Pi CLI khởi động (in context-mode warning) nhưng block trên provider/model call.

### 3.3 Chain of failure

```
pi-crew background run
  → runtime-resolver.ts: fallback to child-process
  → async-runner.ts: resolve jiti-register.mjs
  → spawn("pi", [...args], { cwd, env })
  → Pi CLI starts, prints "[pi-crew] background loader=jiti"
  → Pi tries to connect to model provider
  → BLOCKS INDEFINITELY — no stdout, no stderr, no error
  → 300,000ms (5 min) heartbeat timeout
  → worker.response_timeout: "No output for 300000ms"
  → task.failed → run.failed
```

### 3.4 Tại sao live-session vẫn hoạt động?

| Aspect | Live-session | Child-process |
|---|---|---|
| Provider connection | **Reuse** parent Pi's connection | Tạo connection mới |
| Auth context | Share với parent | Phải tự thiết lập |
| Startup time | Nhanh (no new process) | Chậm (spawn + init) |
| Background capable | ❌ Không | ✅ Có (nếu provider hoạt động) |

### 3.5 Nguyên nhân có thể

| # | Nguyên nhân | Khả năng | Cách verify |
|---|---|---|---|
| 1 | **API key không inherit** bởi child process env | Cao | Check `sanitizeEnvSecrets()` có filter quá aggressive không |
| 2 | **Provider endpoint unreachable** từ child process | Trung bình | `curl` đến provider API từ child env |
| 3 | **Provider rate limiting** (parent + child concurrent) | Trung bình | Check provider response headers |
| 4 | **jiti loader stall** — TS compilation hangs | Thấp | jiti import thành công (log confirmed) |

### 3.6 Key files liên quan

```
pi-crew/src/runtime/
├── async-runner.ts       — resolveTypeScriptLoader(), spawn args với --import jiti-register.mjs
├── child-pi.ts           — runChildPi(), response timeout, stdout capture
│                           buildChildPiSpawnOptions() → { cwd, env: sanitizeEnvSecrets(env) }
├── background-runner.ts  — Background entry point
├── pi-spawn.ts           — getPiSpawnCommand() → { command: "pi", args }
├── pi-args.ts            — buildPiWorkerArgs() → args array
└── worker-heartbeat.ts   — Heartbeat stale check (5 min default)

pi-crew/src/config/defaults.ts
└── DEFAULT_CHILD_PI.responseTimeoutMs = 5 * 60_000  (300s)

pi-crew/src/utils/env-filter.ts
└── sanitizeEnvSecrets()  — Filter secret env vars (có thể quá aggressive?)
```

### 3.7 Khuyến nghị fix

1. **Immediate:** Chạy `pi --print "test"` trên terminal để confirm provider connection issue
2. **Check `sanitizeEnvSecrets()`:** Verify API keys (GOOGLE_API_KEY, MINIMAX_API_KEY, ZAI_API_KEY, etc.) không bị filter
3. **Thêm error logging:** Capture stderr từ child Pi process vào background.log
4. **Thêm connection timeout:** Pi CLI nên timeout sau ~30s nếu provider không respond, thay vì block vô hạn
5. **Test workaround:** Set `PI_TEAMS_MOCK_CHILD_PI=success` để bypass provider call, verify pi-crew logic riêng

---

## 4. Vấn đề phụ: Stale heartbeat notifications sau prune

### 4.1 Mô tả

Sau khi chạy `team prune`, background watcher vẫn emit "Task heartbeat dead" notifications cho runs đã bị xóa.

### 4.2 Pattern

```
team prune --keep=0 --confirm=true   → 9 runs removed
→ Notification: "agent_mpc423rq_1 heartbeat dead" (run đã prune)
→ Notification: "agent_mpc423rv_2 heartbeat dead" (run đã prune)
→ Notification: "agent_mpc423rw_3 heartbeat dead" (run đã prune)
→ Notification: "agent_mpc423rw_4 heartbeat dead" (run đã prune)
→ ... (tổng cộng 6+ stale notifications)
```

### 4.3 Nguyên nhân

Background watcher duy trì queue của worker health checks. Khi runs bị prune, watcher không deregister ngay — notifications đã trong queue vẫn được emit.

### 4.4 Severity: LOW (cosmetic)

### 4.5 Khuyến nghị

- Background watcher nên check run existence trước khi emit heartbeat alerts
- Hoặc: watcher nên deregister workers khi runs bị prune

---

## 5. Vấn đề phụ: Live-session run bị cancel giữa chừng

### 5.1 Mô tả

Fast-fix team chạy live-session, task `01_explore` hoàn thành thành công nhưng run bị cancelled trước khi `02_execute` bắt đầu.

### 5.2 Events

```
04:12:20 live-session.prompt_start 01_explore
04:12:51 live-session.prompt_done 01_explore
04:12:51 live_agent.terminated 01_explore (status=cancelled)
04:12:51 task.completed 01_explore
04:12:51 run.cancelled: "This operation was aborted"
```

### 5.3 Nguyên nhân có thể

- Session concurrency limit (chỉ 1 live-session active)
- User-initiated cancellation
- Conflict với concurrent test operations

### 5.4 Severity: MEDIUM

---

## 6. Tính năng hoạt động ổn định

Danh sách các tính năng đã test và hoạt động chính xác:

### Resource Discovery
- ✅ `team list` — Liệt kê teams, workflows, agents, recent runs
- ✅ `team get` — Chi tiết team/workflow/agent
- ✅ `team recommend` — Gợi ý team phù hợp dựa trên goal
- ✅ `team validate` — Validate tất cả resources

### Diagnostics
- ✅ `team doctor` — 17 checks (runtime, filesystem, discovery, drift, schema, async, worktrees)
- ✅ `team help` — Full command reference

### State Management
- ✅ `team status` — Run state với task graph, events, policy decisions
- ✅ `team events` — Chronological event log chi tiết
- ✅ `team artifacts` — Liệt kê artifact files (prompts, results, metadata, logs)
- ✅ `team summary` — Concise run overview
- ✅ `team prune` — Cleanup runs với audit trail (prune.jsonl)
- ✅ `team cancel` — Cancel running/queued runs

### Portability
- ✅ `team export` — Export run thành JSON + Markdown
- ✅ `team import` — Import run bundle, tạo README.md summary

### Configuration
- ✅ `team settings` — Show effective settings (agent overrides, UI, autonomous)
- ✅ `team autonomy` — Show/set autonomous mode profile

### Planning
- ✅ `team plan` — Tạo execution plan với structured steps

### Retry
- ✅ `team retry` — Re-queue failed tasks

---

## 7. Configuration hiện tại

### Autonomous Mode
```
Profile: suggested
Enabled: true
Inject policy: true
Prefer async for long tasks: false
Allow worktree suggestion: true
```

### Agent Model Overrides
| Agent | Model | Thinking |
|---|---|---|
| explorer | minimax/MiniMax-M2.7-highspeed | off |
| writer | minimax/MiniMax-M2.7-highspeed | off |
| planner | zai/glm-5.1 | medium |
| analyst | minimax/MiniMax-M2.7-highspeed | off |
| critic | minimax/MiniMax-M2.7 | low |
| executor | zai/glm-5.1 | medium |
| reviewer | minimax/MiniMax-M2.7 | off |
| security-reviewer | minimax/MiniMax-M2.7 | medium |
| test-engineer | zai/glm-5.1 | low |
| verifier | minimax/MiniMax-M2.7 | off |

### Timeouts
```
DEFAULT_CHILD_PI.responseTimeoutMs = 300,000 (5 min)
DEFAULT_LIVE_SESSION.responseTimeoutMs = 600,000 (10 min)
```

---

## 8. Files liên quan

| File | Mô tả |
|---|---|
| `/home/bom/source/my_pi/pi-crew-test-results.md` | Báo cáo test chi tiết |
| `/home/bom/.pi/agent/pi-crew.json` | pi-crew config |
| `/home/bom/.pi/agent/agents/explorer.md` | Explorer agent config |
| `/home/bom/.pi/agent/agents/security-reviewer.md` | Security reviewer config |
| `/home/bom/.pi/agent/agents/test-engineer.md` | Test engineer config |
| `/home/bom/.pi/agent/agents/verifier.md` | Verifier config |
| `/home/bom/source/my_pi/.crew/audit/prune.jsonl` | Prune audit trail (381 entries) |

---

## 9. Next Steps

### Ưu tiên cao
1. **Fix `pi --print` hangs:** Investigate provider connection trong child process
2. **Check `sanitizeEnvSecrets()`:** Verify không filter API keys cần thiết
3. **Thêm stderr logging:** Background.log nên capture stderr từ child Pi

### Ưu tiên trung bình
4. **Test foreground team to completion:** Verify full workflow lifecycle (explore→plan→execute→verify)
5. **Stale notification fix:** Background watcher deregister trên prune

### Ưu tiên thấp
6. **Configurable heartbeat timeout:** Thay hardcode 300s bằng config value
7. **Warm pool implementation:** Hiện tại disabled (size=0), cần Pi-side support
