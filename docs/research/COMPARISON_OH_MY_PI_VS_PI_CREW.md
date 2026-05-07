# ⚖️ So sánh kiến trúc: oh-my-pi vs pi-crew

> Dựa trên deep research cả hai codebase (oh-my-pi v14.7.3 + pi-crew HEAD)

---

## 1. Tổng quan kiến trúc

```
                        oh-my-pi                              pi-crew
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│          Main Process                │  │       Pi Parent Process              │
│                                      │  │                                      │
│  ┌────────────────────────────────┐  │  │  Pi CLI (coding agent)               │
│  │  AgentSession (in-process)     │  │  │    │                                 │
│  │  ├─ TaskTool → createSession() │  │  │    │ team tool → team-runner.ts       │
│  │  │   ├─ AgentSession #1        │  │  │    │   ├─ task-runner.ts             │
│  │  │   ├─ AgentSession #2        │  │  │    │   │   ├─ child-pi.ts → spawn() │
│  │  │   └─ AgentSession #N        │  │  │    │   │   │   ├─ Pi child #1     │
│  │  │                             │  │  │    │   │   │   ├─ Pi child #2     │
│  │  ├─ EventBus (in-process)      │  │  │    │   │   │   └─ Pi child #N     │
│  │  ├─ AgentRegistry (global)     │  │  │    │   │                              │
│  │  └─ SessionObserverRegistry    │  │  │    │   ├─ state-store (files)        │
│  └────────────────────────────────┘  │  │    │   ├─ manifest.json              │
│                                      │  │    │   ├─ tasks.json                 │
│  Tất cả trong 1 process              │  │    │   ├─ events.jsonl               │
│  → Không IPC, không serialization    │  │    │   └─ artifacts/                 │
│  → Direct object references          │  │    │                                  │
│  → Real-time event streaming         │  │    │ File-based coordination           │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

---

## 2. So sánh chi tiết từng subsystem

### 2.1 Execution Model

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Model** | In-process `AgentSession` | Child process `spawn("pi", ...)` |
| **Isolation** | Shared memory, shared event loop | Process-isolated, independent event loop |
| **Startup time** | ~ms (just object creation) | ~seconds (new Pi process boot) |
| **Communication** | Direct method calls | stdout/stderr IPC + file artifacts |
| **Memory** | Shared heap — agents see each other | Separate heaps — no shared state |
| **Failure blast radius** | 1 crashed agent → potential process crash | 1 crashed child → parent unaffected |
| **Concurrency** | `Semaphore` + `mapWithConcurrencyLimit` | `mapConcurrent` + `resolveBatchConcurrency` |
| **Model fallback** | Per-agent `model[]` patterns | `buildConfiguredModelRouting` with candidates loop |

**pi-crew advantage**: Process isolation — crashed worker không ảnh hưởng parent.
**oh-my-pi advantage**: Shared memory — zero IPC overhead, direct event streaming, IRC messaging.

### 2.2 Subagent Lifecycle

```
oh-my-pi:                           pi-crew:
pending → running → completed       queued → running → completed
                    ↘ failed                         ↘ failed
                    ↘ aborted                         ↘ cancelled
                                                      ↘ waiting (mailbox)
                                                      ↘ skipped
```

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Entry** | `TaskTool.execute()` | `team tool run` → `team-runner.ts` |
| **Discovery** | `discoverAgents()` — bundled + .md files | `discoverAgents()` — agents/ dir + .md files |
| **Definition format** | YAML frontmatter in .md | YAML frontmatter in .md |
| **Output submission** | **`yield` tool** (enforced, 3 retries) | **exit code + stdout** (parsed post-hoc) |
| **Recursion control** | `maxRecursionDepth` + `spawns[]` | `maxTaskDepth` env var |
| **Adaptive planning** | N/A | **Adaptive plan injection** — planner dynamically creates tasks |
| **Retry** | N/A (yield reminder only) | `executeWithRetry` — configurable retry policy |
| **Policy engine** | N/A | `evaluateCrewPolicy` + recovery ledger |
| **Plan approval** | N/A | `planApproval` flow for implementation workflow |
| **Effectiveness guard** | N/A | `evaluateRunEffectiveness` — severity levels |

**pi-crew advantages**: Retry policy, adaptive planning, policy engine, plan approval, effectiveness guards.
**oh-my-pi advantages**: Yield enforcement (structured output), spawns[] recursion control.

### 2.3 Inter-Subagent Communication

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Primary mechanism** | **IRC tool** — peer-to-peer messaging | **Mailbox** — async message queue |
| **Registry** | `AgentRegistry.global()` — process singleton | `manifest.json` + `crew-agent-records.json` |
| **Addressing** | Agent ID (`"0-Main"`, `"3-explore-abc"`) | Task ID (`"01_discover"`, `"02_plan"`) |
| **Reply mechanism** | `respondAsBackground()` — ephemeral side-channel | `respond` team tool action |
| **Anti-deadlock** | Side-channel doesn't block recipient's main loop | N/A — mailbox is fire-and-forget |
| **Broadcast** | `irc({ op: "send", to: "all" })` | No broadcast |
| **Visibility** | `listVisibleTo()` — all running/idle agents | `status` team tool — shows all tasks |
| **Event channels** | 3 dedicated channels (event, progress, lifecycle) | 1 `task.progress` event (coalesced) |
| **Steering** | `agent.steer()` — inject message mid-turn | `cancel` + `respond` team tool actions |
| **Context sharing** | `context.md` file + `contextFiles[]` | `dependencyContext` + `task-output-context.ts` |

**oh-my-pi advantages**: Real-time IRC, anti-deadlock side-channel, broadcast, steering mid-turn.
**pi-crew advantages**: Async mailbox (persists to disk), dependency context (auto-collects upstream outputs), more coordination patterns via team tool.

### 2.4 Progress Tracking

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Event source** | `AgentEvent` subscription (in-process) | JSON lines from child stdout + transcript.jsonl |
| **Debounce** | 150ms coalescing | 500ms agent record + 1000ms progress event |
| **Tracked data** | toolName, toolArgs, tokens, recentOutput (8 lines), intent | toolName, toolCount, tokens, recentOutput (20 lines), usage |
| **Heartbeat** | N/A (shared process = instant status) | `worker-heartbeat.ts` — file-based heartbeat |
| **Attention detection** | N/A | `agent-control.ts` — `needs_attention`, `long_running`, consecutive failures |
| **Crash recovery** | N/A | `crash-recovery.ts`, `stale-reconciler.ts`, `overflow-recovery.ts` |
| **Deadletter** | N/A | `deadletter.ts` — tracks permanently failed tasks |

**oh-my-pi advantages**: Real-time events (no file polling needed), 150ms fast updates.
**pi-crew advantages**: Crash recovery, stale reconciliation, attention detection, deadletter — much more robust for unreliable environments.

### 2.5 UI Rendering

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Main display** | `SessionObserverOverlay` — full transcript viewer | `RunDashboard` — multi-pane dashboard |
| **Progress bar** | `statusLine` with subagent count | `powerbar-publisher.ts` — segment-based |
| **Transcript** | Incremental JSONL reading, expand/collapse per entry | `transcript-viewer.ts` — syntax-highlighted, diff rendering |
| **Agent config UI** | `AgentDashboard` (1120 lines) — two-column agent manager | N/A (config via YAML files) |
| **Dashboard panes** | N/A (single overlay) | 7 panes: agents, progress, mailbox, health, metrics, capability, transcript |
| **Anti-flicker** | 150ms progress coalesce, viewport-only render | `file-coalescer.ts` (200ms TTL), `render-scheduler.ts` |
| **Snapshot cache** | N/A (in-process = instant) | `run-snapshot-cache.ts` (777 lines) — file mtime-based cache |
| **Live streaming** | `message_update` events (text_delta) in real-time | JSON stdout line parsing (batched) |

**oh-my-pi advantages**: Real-time streaming, entry-based expand/collapse, agent configuration UI.
**pi-crew advantages**: Richer dashboard (7 panes), syntax highlighting, diff rendering, snapshot caching for multiple runs.

### 2.6 Tool Access Control

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Mechanism** | `agent.tools[]` in frontmatter → passed to `createAgentSession` | `permissionForRole()` → read_only vs read_write |
| **Granularity** | Per-agent tool whitelist | Per-role permission level |
| **MCP proxy** | `createMCPProxyTools()` — reuse parent's connections | N/A |
| **Plan mode** | Restrict to `["read", "search", "find", "lsp", "web_search"]` | `permissionForRole("planner") === "read_only"` |
| **LoadMode** | `"essential"` vs `"discoverable"` per tool | N/A (just added `toolGuidanceBlock`) |
| **Recursion tool** | Auto-add `"task"` tool when `spawns` defined | N/A (no subagent spawning from workers) |

### 2.7 Isolation & Merge

| | oh-my-pi | pi-crew |
|---|---------|---------|
| **Isolation modes** | worktree, fuse-overlay, fuse-projfs | worktree only |
| **Merge modes** | patch, branch | patch (auto-captured) |
| **Commit style** | AI-generated or simple | N/A |
| **Nested repos** | `NestedRepoPatch` support | N/A |

---

## 3. Feature Matrix

| Feature | oh-my-pi | pi-crew |
|---------|:--------:|:-------:|
| In-process execution | ✅ | ❌ (child process) |
| Process isolation | ❌ | ✅ |
| Yield tool enforcement | ✅ | ❌ |
| IRC messaging | ✅ | ❌ (mailbox only) |
| Broadcast messaging | ✅ | ❌ |
| Steering mid-turn | ✅ | ❌ (cancel/respond only) |
| Anti-deadlock side-channel | ✅ | ❌ |
| Real-time event streaming | ✅ | ❌ (file-based) |
| Adaptive planning | ❌ | ✅ |
| Retry policy | ❌ | ✅ |
| Policy engine | ❌ | ✅ |
| Plan approval flow | ❌ | ✅ |
| Effectiveness guard | ❌ | ✅ |
| Crash recovery | ❌ | ✅ |
| Stale reconciliation | ❌ | ✅ |
| Deadletter tracking | ❌ | ✅ |
| Attention detection | ❌ | ✅ |
| Mailbox (async) | ❌ | ✅ |
| Dependency context | ❌ | ✅ |
| Multi-run dashboard | ❌ | ✅ |
| Syntax highlighting | ❌ | ✅ |
| Diff rendering | ❌ | ✅ |
| Snapshot caching | ❌ | ✅ |
| Agent configuration UI | ✅ | ❌ |
| MCP proxy tools | ✅ | ❌ |
| Worktree isolation | ✅ | ✅ |
| FUSE/ProjFS isolation | ✅ | ❌ |
| Branch-based merge | ✅ | ❌ |

---

## 4. Phân tích gap — pi-crew thiếu gì

### Gap 1: Real-time Event Streaming (HIGH)
- **oh-my-pi**: In-process EventBus → events arrive in <1ms
- **pi-crew**: File-based (write manifest → poll) → 500-1000ms latency
- **Impact**: UI flickers, feels "chập chờn", delayed progress updates
- **Solution path**: WebSocket/pipe from child Pi → parent, or use Pi's JSON event stream directly

### Gap 2: Structured Output (MEDIUM)
- **oh-my-pi**: `yield` tool enforces structured output with JTD schema
- **pi-crew**: Parse stdout + transcript post-hoc
- **Impact**: Fragile output parsing, no schema validation
- **Solution path**: Add output schema support to task packets, or use exit code conventions

### Gap 3: Inter-Worker Communication (MEDIUM)
- **oh-my-pi**: IRC tool + AgentRegistry + side-channel
- **pi-crew**: Mailbox (fire-and-forget) + dependency context (read-only)
- **Impact**: Workers can't coordinate in real-time
- **Solution path**: Enhanced mailbox with reply support, or IPC bridge

### Gap 4: Steering/Cancellation Granularity (LOW)
- **oh-my-pi**: `steer()` injects messages mid-turn, `interruptMode: "immediate"`
- **pi-crew**: `cancel` kills child process, `respond` adds to mailbox
- **Impact**: Can't course-correct a running worker without killing it
- **Solution path**: Pi's native `steer` support (if exposed via CLI)

### Gap 5: Agent Configuration UI (LOW)
- **oh-my-pi**: Full `AgentDashboard` — enable/disable, model override, AI agent creation
- **pi-crew**: Edit YAML files manually
- **Impact**: Poor UX for agent management
- **Solution path**: Build a similar dashboard component in pi-crew

---

## 5. Phân tích gap — oh-my-pi thiếu gì (pi-crew có)

### pi-crew Advantage 1: Process Isolation
Crashed worker → parent unaffected. Critical for production reliability.

### pi-crew Advantage 2: Adaptive Planning
`implementation` workflow dynamically injects tasks based on planner output. No equivalent in oh-my-pi.

### pi-crew Advantage 3: Robustness Layer
- Retry policy with backoff
- Crash recovery + stale reconciliation
- Deadletter tracking
- Effectiveness guard with severity levels
- Policy engine with block/escalate/notify

### pi-crew Advantage 4: Dependency Context
Auto-collects upstream task outputs and feeds them to downstream tasks. oh-my-pi only shares `context.md`.

### pi-crew Advantage 5: Rich Dashboard
7 specialized panes vs oh-my-pi's single overlay. Better for monitoring multiple parallel runs.

---

## 6. Kết luận

| Aspect | Winner | Reason |
|--------|--------|--------|
| **Execution speed** | oh-my-pi | In-process, zero IPC |
| **Reliability** | pi-crew | Process isolation + crash recovery |
| **Communication** | oh-my-pi | IRC + side-channel + steering |
| **Coordination** | pi-crew | Adaptive planning + dependency context |
| **UI richness** | pi-crew | 7 dashboard panes + syntax highlighting |
| **UI responsiveness** | oh-my-pi | Real-time events + 150ms coalescing |
| **Robustness** | pi-crew | Retry + deadletter + effectiveness guard |
| **Tool control** | oh-my-pi | Per-agent whitelist + MCP proxy |
| **Configuration UX** | oh-my-pi | Agent dashboard with AI creation |

**Tóm lại**: pi-crew mạnh về **reliability và coordination**, yếu về **real-time responsiveness và inter-worker communication**. oh-my-pi mạnh về **speed và real-time**, yếu về **robustness và fault tolerance**.

**Priority improvements cho pi-crew**:
1. 🔴 Real-time event streaming → giảm UI flicker
2. 🟡 Structured output enforcement → giảm parsing fragility
3. 🟡 Inter-worker communication → tăng coordination capability
4. 🟢 Agent configuration UI → tăng UX
5. 🟢 Steering granularity → tăng control fidelity
