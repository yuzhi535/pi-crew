# So sánh kiến trúc: pi-subagents3 vs pi-crew

> Ngày: 2026-05-12  
> Source: `@tintinweb/pi-subagents` v0.7.1 (6.082 LOC, 28 files) vs `pi-crew` v0.2.3 (35.809 LOC, ~200+ files)

---

## 1. Tổng quan

| Tiêu chí | pi-subagents3 | pi-crew |
|---|---|---|
| **Tác giả** | tintinweb | baphuongna |
| **Phiên bản** | 0.7.1 | 0.2.3 |
| **Mục tiêu** | Subagent đơn lẻ (Agent tool) — spawn, resume, steer | Team orchestration — multi-agent workflows, phases, parallel dispatch |
| **LOC** | ~6.000 | ~36.000 |
| **Entry point** | `src/index.ts` (1.885 dòng — monolith) | `index.ts` → `register.ts` (668 dòng) → modular registration |
| **Kiến trúc** | Đơn giản, trực tiếp, single-agent focus | Layered, event-driven, state-machine based |
| **Peer deps** | pi-ai ≥0.70.5, pi-coding-agent ≥0.70.5, pi-tui ≥0.70.5 | pi-coding-agent (runtime) |
| **Npm deps** | `@sinclair/typebox`, `croner`, `nanoid` | 0 (zero runtime dependencies) |
| **Test runner** | vitest | Node built-in `--experimental-strip-types` |
| **Subprocess model** | **In-process** (tái sử dụng Pi SDK `createAgentSession`) | **Out-of-process** (spawn child Pi instance via `child-pi.ts`) |

---

## 2. Kiến trúc cốt lõi

### 2.1 pi-subagents3 — In-process Agent Sessions

```
┌─────────────────────────────────────────────┐
│              index.ts (1885 LOC)             │
│  Extension entry: tools, commands, menus,    │
│  lifecycle hooks, settings, scheduling       │
├─────────┬──────────┬──────────┬──────────────┤
│agent-   │agent-    │agent-    │schedule.ts   │
│runner   │manager   │types     │ScheduleStore │
│(310 LOC)│(310 LOC) │(140 LOC) │(365 LOC)     │
├─────────┴──────────┴──────────┴──────────────┤
│ memory.ts │ prompts.ts │ context.ts │ env.ts │
│ worktree  │ model-     │ settings   │ usage  │
│           │ resolver   │            │        │
├──────────────────────────────────────────────┤
│           Pi SDK (createAgentSession)         │
│     In-process, shared event loop            │
└──────────────────────────────────────────────┘
```

**Đặc điểm chính:**
- Agent chạy **trong cùng process** với parent Pi session
- Dùng `createAgentSession()` + `session.prompt()` — Pi SDK API trực tiếp
- Tool filtering, extension binding, skill preloading trong process
- Event subscription (`session.subscribe()`) để track turns, tool uses, streaming text
- 1 file `index.ts` khổng lồ chứa gần như toàn bộ logic

### 2.2 pi-crew — Out-of-process Child Workers

```
┌─────────────────────────────────────────────────────────┐
│                   register.ts (668 LOC)                  │
│  Extension entry: lifecycle, commands, tool registration  │
├────────────────┬─────────────────┬───────────────────────┤
│  team-tool.ts  │  team-runner.ts │  subagent-manager.ts  │
│  (344 LOC)     │  (945 LOC)      │  (400 LOC)            │
│  Tool handler  │  Workflow engine │  Agent tracking       │
├────────────────┴─────────────────┴───────────────────────┤
│  child-pi.ts (461 LOC) │ task-runner.ts (459 LOC)        │
│  Subprocess spawn      │ Per-worker execution             │
├─────────────────────────┬───────────────────────────────┤
│     State Layer         │        UI Layer                │
│  state-store.ts         │  crew-widget.ts                │
│  event-log.ts           │  run-dashboard.ts              │
│  locks.ts               │  transcript-viewer.ts          │
│  atomic-write.ts        │  powerbar-publisher.ts         │
├─────────────────────────┴───────────────────────────────┤
│       Pi CLI (child process via spawn)                   │
│     Isolated process, independent event loop             │
└─────────────────────────────────────────────────────────┘
```

**Đặc điểm chính:**
- Worker chạy **riêng process** — spawn `pi` CLI child process
- Giao tiếp qua JSON events trên stdout (`--json-output` mode)
- State persistence: JSONL event log, manifest files, atomic writes
- Kiến trúc phân tán: team → workflow → phases → tasks → workers
- Tách biệt hoàn toàn: crash recovery, stuck detection, deadletter

---

## 3. So sánh chi tiết theo module

### 3.1 Agent Execution

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Runtime** | `createAgentSession()` in-process | `spawn("pi", [...])` child process |
| **Tool access** | Direct — `session.setActiveToolsByName()` | Giới hạn bởi child Pi args |
| **Context sharing** | `buildParentContext()` — copy conversation | Không share (isolated by design) |
| **Steering** | `session.steer(message)` — immediate in-process | `child.stdin.write()` — JSON event |
| **Resume** | `resumeAgent(session, prompt)` — reuse session | Re-spawn child process |
| **Turn limits** | Soft limit → steer "wrap up" → hard abort | `--max-turns` CLI arg → child exit |
| **Grace turns** | Configurable (default 5) | N/A |
| **Streaming** | `session.subscribe()` — real-time deltas | JSON event polling on stdout |
| **Compaction** | Tracked via `compaction_end` events | Child handles independently |
| **Memory overhead** | Low (shared process) | High (separate Node.js process) |
| **Isolation** | Process-shared (same memory space) | Process-isolated (crash-safe) |
| **Max concurrent** | Queue with configurable limit (default 4) | Queue with configurable limit (default 4) |

### 3.2 Agent Configuration

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Built-in agents** | 3: general-purpose, Explore, Plan | 10: explorer, planner, executor, reviewer, verifier, analyst, critic, writer, security-reviewer, test-engineer |
| **Custom agents** | `.md` files in `.pi/agents/` or `~/.pi/agents/` | `.md` files in `agents/` (project) |
| **Agent config** | 22 fields: systemPrompt, promptMode, extensions, skills, model, thinking, maxTurns, memory, isolation, disallowedTools... | agent-config.ts: name, systemPrompt (frontmatter), maxTurns |
| **Prompt mode** | `replace` (standalone) or `append` (parent twin) | Always replace (isolated subprocess) |
| **Tool filtering** | Allowlist (builtinToolNames) + denylist (disallowedTools) + extension filter | CLI arg `--allowed-tools` |
| **Model lock** | Per-agent model in config | Per-agent model in frontmatter |
| **Thinking level** | Per-agent `thinking` field | Per-agent `thinkingLevel` in frontmatter |
| **Agent discovery** | `custom-agents.ts` → `.md` frontmatter parse | `discover-agents.ts` → `.md` frontmatter parse |

### 3.3 Memory / Persistence

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Agent memory** | ✅ Persistent MEMORY.md per agent (user/project/local scope) | ❌ Không có built-in agent memory |
| **Memory tools** | Injected dynamically based on write capability | N/A |
| **State persistence** | In-memory AgentRecord + JSON schedule store | Full state machine: manifest.json + events.jsonl + tasks.json |
| **Crash recovery** | Worktree prune on dispose | Detect interrupted runs, deadletter, stuck-blocked notifications |
| **Locking** | PID-based file lock for schedule store | `mkdirSync` atomic lock + PID stale detection for event log |
| **Atomic writes** | temp+rename (POSIX) | Full atomic-write.ts with O_NOFOLLOW, symlink checks, sync/async parity |

### 3.4 Scheduling

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Scheduling** | ✅ Full scheduler: cron (6-field), interval, one-shot | ❌ Không có scheduling |
| **Cron engine** | `croner` library | N/A |
| **Persistence** | Session-scoped JSON with PID-locked store | N/A |
| **Queue bypass** | `bypassQueue: true` for scheduled fires | N/A |
| **Events** | `subagents:scheduled` (added/removed/fired/error) | N/A |
| **Master switch** | `schedulingEnabled` setting (strips tool param) | N/A |

### 3.5 Worktree Isolation

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Worktree support** | ✅ `createWorktree()` / `cleanupWorktree()` | ✅ Full `worktree-manager.ts` (8.8 KB) |
| **Branch management** | Auto-branch, auto-commit changes | Branch freshness, reuse, file node_modules skip |
| **Error handling** | Strict — throws if worktree creation fails | Retry + fallback |
| **Cleanup** | On completion (success or error) + prune on dispose | On completion + cleanup.ts + branch-freshness |

### 3.6 Cross-extension Communication

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **RPC protocol** | ✅ Event bus RPC: ping/spawn/stop | ✅ Event bus RPC: ping/spawn/status/cancel |
| **Protocol version** | v2 | Versioned |
| **Reply envelope** | `{ success: true, data? }` / `{ success: false, error }` | Similar |
| **Singleton access** | `Symbol.for("pi-subagents:manager")` on globalThis | `globalThis.__piCrewRuntimeCleanup` |

### 3.7 UI / TUI

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Agent widget** | `agent-widget.ts` (518 LOC) — overlay | `crew-widget.ts` (16 KB) — sidebar + dashboard |
| **Conversation viewer** | `conversation-viewer.ts` (243 LOC) | `transcript-viewer.ts` (13.9 KB) — JSONL-based |
| **Schedule menu** | `schedule-menu.ts` (104 LOC) | N/A |
| **Dashboard** | N/A (overlay-based) | `run-dashboard.ts` (22.7 KB) — multi-pane |
| **Status bar** | Inline status in overlay | `powerbar-publisher.ts` (8.9 KB) |
| **Live sidebar** | N/A | `live-run-sidebar.ts` (8.6 KB) |
| **Notification render** | Custom `renderCall` / `renderResult` | `notification-router.ts` + `notification-sink.ts` |
| **Context % indicator** | ✅ Token count + context % (colored) + compaction count | ❌ Không có context indicator |

### 3.8 Settings / Configuration

| Khía cạnh | pi-subagents3 | pi-crew |
|---|---|---|
| **Settings file** | `.pi/subagents.json` (project) + `~/.pi/agent/subagents.json` (global) | `config.ts` → `.pi/crew-config.json` + `defaults.ts` |
| **Runtime settings** | maxConcurrent, defaultMaxTurns, graceTurns, defaultJoinMode, schedulingEnabled | maxConcurrent, telemetry, notifications |
| **Validation** | `sanitize()` with ceiling values | `config.ts` schema validation |
| **Hot reload** | Apply on change + emit event | Load on register |

---

## 4. Tính năng độc đáo

### pi-subagents3 có nhưng pi-crew không:

1. **In-process agent sessions** — Zero subprocess overhead, direct Pi SDK access, shared event loop
2. **Persistent agent memory** — MEMORY.md per agent với 3 scope (user/project/local), auto-injected tools
3. **Soft turn limit + grace period** — Steer "wrap up" trước khi hard-abort, configurable grace turns
4. **Scheduling** — Full cron/interval/one-shot scheduler với croner, session-scoped persistence
5. **Parent context inheritance** — `inheritContext` fork conversation cho subagent
6. **Append mode** — Agent chạy như "twin" của parent (kế thừa system prompt + tools)
7. **Context % indicator** — Live context window utilization (%), compaction count (↻N)
8. **Agent memory tools** — Dynamic tool injection based on write capability (read-only vs read-write)
9. **Skill preloading** — Load skill content directly into system prompt (string[])
10. **Batch grouping** — 100ms debounce gom nhiều background completions thành 1 notification
11. **Cancelable nudges** — 200ms hold trước khi gửi notification, get_subagent_result hủy nudge
12. **Agent creation wizard** — `/agents` → spawn agent để tạo agent config .md file

### pi-crew có nhưng pi-subagents3 không:

1. **Team orchestration** — Multi-agent teams với workflows, phases, parallel dispatch
2. **Workflow engine** — Declarative workflow definitions (step → agent → gate → next)
3. **Out-of-process isolation** — Child Pi process, crash-safe, independent event loop
4. **Full state machine** — manifest.json + tasks.json + events.jsonl, durable persistence
5. **Crash recovery** — Detect interrupted runs, deadletter queue, stuck-blocked detection
6. **Mailbox system** — Interactive respond/nudge/ack workflow cho waiting tasks
7. **Heartbeat monitoring** — `heartbeat-watcher.ts` + gradient-based health tracking
8. **Observability** — Metrics registry, OTLP exporter, Prometheus exporter
9. **Run export/import** — Bundle/unbundle runs cho cross-machine sharing
10. **Live session management** — Live IRC, live agent control, live extension bridge
11. **UI dashboard** — Multi-pane dashboard với agents/capabilities/health/mailbox/progress
12. **Run snapshot cache** — Efficient state snapshots cho UI rendering
13. **Delivery coordination** — Overflow recovery, delivery coordinator cho message routing
14. **i18n** — Internationalization support
15. **Post-checks** — Configurable post-execution verification hooks
16. **Iteration hooks** — Pre/post iteration hooks cho external integrations
17. **Model fallback chain** — Multi-model fallback với cost tracking
18. **Compaction summary** — Context compaction cho long-running agents
19. **Task quality scoring** — Automatic quality assessment of task outputs
20. **Agent capability inventory** — Dynamic tool/skill capability detection

---

## 5. Phân tích ưu/nhược điểm

### pi-subagents3

**Ưu điểm:**
- **Đơn giản**: ~6K LOC, dễ hiểu, dễ maintain
- **Performance**: In-process, zero subprocess overhead, shared memory
- **Tính năng sâu**: Memory, scheduling, context inheritance, turn management rất chi tiết
- **SDK-first**: Sử dụng Pi SDK trực tiếp, tận dụng tối đa API
- **Interactive**: Resume, steer, conversation viewer rất mượt
- **Settings**: Hot-reload, master switch cho features

**Nhược điểm:**
- **Monolith**: `index.ts` 1.885 dòng — khó maintain, khó test
- **No team support**: Không có workflow, phases, parallel dispatch
- **Crash propagation**: Agent crash ảnh hưởng parent process
- **Limited observability**: Không có metrics, export, monitoring
- **No run persistence**: Agent record chỉ in-memory (trừ schedule store)

### pi-crew

**Ưu điểm:**
- **Kiến trúc mạnh**: Layered, event-driven, state-machine based
- **Team orchestration**: Workflow engine với phases, parallel, gates
- **Crash isolation**: Out-of-process workers, child crash không ảnh hưởng parent
- **Full persistence**: JSONL event log, manifest, atomic writes
- **Observability**: Metrics, OTLP, Prometheus, heartbeat monitoring
- **Modular**: 200+ files, mỗi file một trách nhiệm
- **Enterprise features**: Export/import, i18n, compaction, quality scoring

**Nhược điểm:**
- **Phức tạp**: 36K LOC, learning curve cao
- **Subprocess overhead**: Mỗi worker spawn riêng process (RAM, startup time)
- **Không có memory**: Agents không có persistent memory giữa sessions
- **Không có scheduling**: Không có cron/interval/one-shot
- **Không có context inheritance**: Workers chạy isolated, không thấy parent context
- **Không có soft turn limit**: Hard cutoff, không có grace period
- **Không có interactive steer**: Không thể steer worker sau khi spawn

---

## 6. Khuyến nghị

### pi-crew nên học từ pi-subagents3:

1. **Persistent agent memory** — MEMORY.md pattern rất giá trị cho long-running projects
2. **Soft turn limit + grace period** — Elegant hơn hard abort
3. **Scheduling** — Cron/interval scheduling cho automated tasks
4. **Context % indicator** — Giúp LLM parent biết subagent còn bao nhiêu room
5. **Batch notification grouping** — Giảm noise khi nhiều workers complete đồng thời
6. **In-process mode** (optional) — Cho lightweight tasks không cần process isolation
7. **Cancelable nudges** — Tránh notification spam
8. **Agent settings hot-reload** — Thay đổi settings mà không cần restart

### pi-subagents3 nên học từ pi-crew:

1. **Modular architecture** — Tách `index.ts` thành nhiều files
2. **State persistence** — Durable state thay vì chỉ in-memory
3. **Crash recovery** — Detect interrupted runs, deadletter
4. **Observability** — Metrics, monitoring, health checks
5. **Team support** — Multi-agent workflows
6. **Out-of-process option** — Cho heavy tasks cần isolation
7. **Run export/import** — Cross-machine sharing

---

## 7. Kết luận

**pi-subagents3** là một extension **tập trung** — làm rất tốt một việc: spawn và quản lý individual subagents. Nó tận dụng Pi SDK tối đa, in-process, interactive, với những tính năng sâu như memory và scheduling.

**pi-crew** là một **orchestration platform** — broader scope, mạnh về team workflows, state management, crash recovery, và enterprise features. Nhưng phức tạp hơn nhiều và thiếu một số tính năng "nice-to-have" mà pi-subagents3 có.

Hai extension **complement** nhau hơn là compete:
- pi-subagents3 cho **quick, interactive subagent tasks** (code review, exploration, one-off analysis)
- pi-crew cho **complex, multi-phase team workflows** (full feature implementation, multi-perspective review, parallel research)

Một kiến trúc lý tưởng có thể kết hợp: dùng pi-subagents3's in-process execution cho lightweight tasks, và pi-crew's orchestration layer cho complex workflows.
