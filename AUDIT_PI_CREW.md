# 🔍 pi-crew Codebase Deep Audit

> **Ngày**: 2026-05-07  
> **Commit**: `682194c`  
> **Codebase**: `pi-crew/` — `src/` + `test/`

---

## 1. Tổng quan Architecture

### End-to-End Flow

```
User → Pi CLI → team tool → team-tool.ts (dispatcher)
  ↓
team-tool/run.ts → validate resources → create manifest + tasks
  ↓
team-runner.ts → build task graph → resolve ready tasks → batch by concurrency
  ↓
task-runner.ts → spawn child Pi process → capture stdout/stderr JSONL
  ↓
child-pi.ts → process management (spawn, timeout, kill, drain)
  ↓
State layer (manifest.json, tasks.json, events.jsonl, mailbox.jsonl)
  ↓
UI layer (crew-widget, run-dashboard, powerbar-publisher, snapshot-cache)
```

### Design Patterns chính

- **Artifact-per-operation**: Mỗi task produces 8-15+ artifacts (prompt, result, log, transcript, verification, startup-evidence, capabilities, prompt-pipeline, diff, diff-stat, task-packet, skills, coordination-bridge, inputs, shared-output, summary)
- **Event sourcing**: All mutations logged as JSONL events với sequence numbers và fingerprints
- **Caching với mtime stamps**: Manifest cache và snapshot cache dùng file stat mtime/size comparisons
- **Safety-by-default**: Scaffold mode disables workers; path containment checks; depth guards; plan approval gates

---

## 2. Key Files & Responsibilities

### Core Runtime

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/runtime/team-runner.ts` | ~520 | Core workflow scheduler, adaptive plan injection, task graph execution, policy application |
| `src/runtime/task-runner.ts` | ~430 | Per-task execution, model fallback, artifact persistence, worktree management |
| `src/runtime/child-pi.ts` | ~380 | Child Pi process spawning, stdout/stderr capture, timeout handling, process tree kills |
| `src/runtime/task-graph-scheduler.ts` | ~130 | Dependency graph resolution, ready/blocked/failed task classification |
| `src/runtime/retry-executor.ts` | ~90 | Generic retry với exponential backoff và jitter |
| `src/runtime/agent-control.ts` | ~200 | Attention detection, consecutive failure tracking, long-running task alerts |
| `src/runtime/crash-recovery.ts` | ~150 | Crash state detection và recovery |
| `src/runtime/overflow-recovery.ts` | ~130 | Overflow/compaction state machine tracking |
| `src/runtime/stale-reconciler.ts` | ~100 | Stale run detection và reconciliation |
| `src/runtime/deadletter.ts` | ~80 | Permanently failed task tracking |

### Extension Layer

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/extension/register.ts` | ~550 | Extension registration, session lifecycle, observability, UI wiring |
| `src/extension/team-tool.ts` | ~400 | Tool action dispatcher (~25 actions), resume logic, checkpoint recovery |
| `src/extension/team-tool/run.ts` | ~300 | Run action handler, manifest creation, async/foreground routing |
| `src/extension/team-tool/api.ts` | ~200 | Public API operations (list, get, status, diff, etc.) |
| `src/extension/team-tool/cancel.ts` | ~100 | Cancel action handler |
| `src/extension/team-tool/respond.ts` | ~80 | Mailbox respond action |
| `src/extension/team-tool/status.ts` | ~100 | Status display action |

### State Layer

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/state/state-store.ts` | ~250 | Run manifest CRUD, path resolution, manifest caching |
| `src/state/mailbox.ts` | ~380 | Inter-task message passing, inbox/outbox, delivery state, reply support |
| `src/state/event-log.ts` | ~180 | JSONL event append, sequence numbering, cursor reads |
| `src/state/types.ts` | ~220 | Core types: manifest, tasks, artifacts, policies, output schema |
| `src/state/contracts.ts` | ~110 | Status enums, transition tables, event types |
| `src/state/blob-store.ts` | ~120 | Large binary/text blob storage |
| `src/state/active-run-registry.ts` | ~60 | In-memory tracking of active runs |

### UI Layer

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/ui/run-dashboard.ts` | ~460 | Interactive TUI dashboard với panes và keybindings |
| `src/ui/run-snapshot-cache.ts` | ~550 | Aggressive caching cho dashboard render, async preloading, stamp-based staleness |
| `src/ui/crew-widget.ts` | ~360 | Status bar widget rendering, frame-based animation |
| `src/ui/powerbar-publisher.ts` | ~130 | Powerbar segment updates (coalesced) |
| `src/ui/transcript-viewer.ts` | ~335 | Syntax-highlighted transcript display, diff rendering |
| `src/ui/transcript-entries.ts` | ~200 | Entry-based transcript navigation (expand/collapse) |
| `src/ui/agent-management-overlay.ts` | ~130 | Agent config viewer |
| `src/ui/render-coalescer.ts` | ~60 | Render request batching (debounce) |
| `src/ui/render-scheduler.ts` | ~143 | Scheduled render coordination |
| `src/ui/run-event-bus.ts` | ~98 | In-process event bus cho UI updates |

### Config

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/config/config.ts` | ~840 | Config loading, merging, validation, autonomous settings |
| `src/config/defaults.ts` | ~200 | Default values cho all config options |

### Agents & Discovery

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/agents/agent-config.ts` | ~80 | AgentConfig type definition |
| `src/agents/discover-agents.ts` | ~120 | Agent discovery từ agents/ dir + .md files |
| `src/agents/agent-search.ts` | ~140 | BM25 agent search (weighted fields) |
| `src/agents/agent-serializer.ts` | ~60 | Agent config serialization/deserialization |

### Utilities

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/utils/visual.ts` | ~200 | visibleWidth (emoji/CJK aware), truncate, pad, wrapHard |
| `src/utils/safe-paths.ts` | ~50 | Path traversal prevention, containment validation |
| `src/utils/redaction.ts` | ~40 | Secret redaction cho logs/artifacts |
| `src/utils/frontmatter.ts` | ~80 | YAML frontmatter parsing |
| `src/utils/paths.ts` | ~60 | Project/user path resolution |
| `src/utils/file-coalescer.ts` | ~40 | File read coalescing (debounce) |
| `src/utils/sse-parser.ts` | ~120 | SSE event stream parser |
| `src/utils/scan-cache.ts` | ~80 | Directory scan caching |

### New Runtime Utilities (Phase 1-4 additions)

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/runtime/event-stream-bridge.ts` | ~80 | Bridge child Pi JSON events → RunEventBus |
| `src/runtime/result-extractor.ts` | ~130 | Structured JSON extraction từ worker output |
| `src/runtime/stream-preview.ts` | ~140 | Live output capture và preview |
| `src/runtime/code-summary.ts` | ~240 | Regex-based code summarizer (TS/JS/Python/Rust) |
| `src/runtime/notebook-helpers.ts` | ~90 | .ipynb parser/editor |
| `src/runtime/workspace-tree.ts` | ~100 | Workspace tree builder |
| `src/runtime/task-output-context.ts` | ~180 | Dependency context collection (structured + artifacts + usage) |
| `src/runtime/task-runner/prompt-builder.ts` | ~200 | Worker prompt construction |
| `src/runtime/task-runner/run-projection.ts` | ~80 | Task run result projection |

### Worktree

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `src/worktree/worktree-manager.ts` | ~150 | Git worktree creation, branch management |
| `src/worktree/setup-hooks.ts` | ~60 | Post-worktree-creation setup scripts |

---

## 3. Bugs & Code Quality Issues

### 🐛 Bug #1: Redundant Ternary trong blob-store.ts (HIGH)

**File**: `src/state/blob-store.ts`  
**Line**: ~60

```typescript
const content = typeof input.content === "string" ? input.content : input.content;
```

**Vấn đề**: Ternary luôn return `input.content` — condition meaningless. Có thể là copy-paste error, ban đầu intended để handle Buffer/Uint8Array fallback.

**Fix**:
```typescript
const content = input.content;
```

Hoặc nếu intended để validate type:
```typescript
if (typeof input.content !== "string") throw new TypeError("content must be string");
const content = input.content;
```

---

### 🐛 Bug #2: Non-null Assertion trên Potentially Empty Array (MEDIUM)

**File**: `src/runtime/team-runner.ts`  
**Line**: ~385

```typescript
manifest = { ...results.at(-1)!.manifest, ... };
```

**Vấn đề**: `results.at(-1)!` assert non-null nhưng nếu `batchTasks` empty (race condition hoặc edge case), sẽ throw TypeError.

**Fix**:
```typescript
const lastResult = results.at(-1);
if (!lastResult) break;
manifest = { ...lastResult.manifest, ... };
```

---

### 🐛 Bug #3: Indentation Sai trong Switch Case (LOW)

**File**: `src/extension/team-tool.ts`  
**Line**: ~267

```typescript
	case "prune": return handlePrune(params, ctx);  // extra tab
```

**Vấn đề**: Copy-paste artifact — case `"prune"` có 1 tab thừa so với các cases khác.

**Fix**: Xóa 1 tab.

---

### 🐛 Bug #4: observeStdoutChunk Creates New Observer Per Call (LOW)

**File**: `src/runtime/child-pi.ts`  
**Line**: ~246

```typescript
function observeStdoutChunk(input: ChildPiRunInput, text: string): void {
    const observer = new ChildPiLineObserver(input);
    observer.observe(text);
    observer.flush();
}
```

**Vấn đề**: Tạo `new ChildPiLineObserver` mỗi call. Trong real code path, observer được tạo 1 lần và reuse. Mock path nên làm tương tự.

---

### 🐛 Bug #5: Silent Event Bus Error Swallowing (LOW)

**File**: `src/state/event-log.ts`  
**Line**: ~151

```typescript
try { emitFromTeamEvent(fullEvent); } catch { /* event bus errors are non-fatal */ }
```

**Vấn đề**: Nếu event bus throws repeatedly (e.g., bug in subscriber), mỗi `appendEvent` call silently continues. Mask real issues.

**Fix**: Thêm debug-level logging:
```typescript
try { emitFromTeamEvent(fullEvent); } catch (error) { logInternalError("event-log.emit", error); }
```

---

## 4. Test Coverage Analysis

### Test Coverage Matrix

| Module | ~Lines | Has Tests? | Test File | Test Count | Coverage |
|--------|--------|-----------|-----------|------------|----------|
| `event-stream-bridge.ts` | 80 | ✅ | `event-stream-bridge.test.ts` | 11 | Good |
| `render-coalescer.ts` | 60 | ✅ | `render-coalescer.test.ts` | 7 | Good |
| `result-extractor.ts` | 130 | ✅ | `result-extractor.test.ts` | 17 | Good |
| `mailbox.ts` | 380 | ✅ | `mailbox-reply.test.ts` | 6 | Partial |
| `task-output-context.ts` | 180 | ✅ | `dependency-context-enhanced.test.ts` | 6 | Partial |
| `transcript-entries.ts` | 200 | ✅ | `transcript-entries.test.ts` | 10 | Good |
| `agent-management-overlay.ts` | 130 | ✅ | `agent-management-overlay.test.ts` | 10 | Good |
| `agent-search.ts` | 140 | ✅ | `agent-search.test.ts` | 8 | Good |
| `code-summary.ts` | 240 | ✅ | `code-summary.test.ts` | 22 | Good |
| `sse-parser.ts` | 120 | ✅ | `sse-parser.test.ts` | 13 | Good |
| `stream-preview.ts` | 140 | ✅ | `stream-preview.test.ts` | 14 | Good |
| `notebook-helpers.ts` | 90 | ✅ | `notebook-helpers.test.ts` | 12 | Good |
| `visual.ts` | 200 | ✅ | `visual.test.ts` | 5 | Good |
| `frontmatter.ts` | 80 | ✅ | `frontmatter.test.ts` | ~8 | Good |
| `config.ts` | 840 | ✅ | `config.test.ts` + others | ~20 | Partial |
| **`child-pi.ts`** | **380** | ❌ | — | 0 | **NONE** |
| **`team-runner.ts`** | **520** | ❌ | — | 0 | **NONE** |
| **`team-tool.ts`** | **400** | ❌ | — | 0 | **NONE** |
| **`state-store.ts`** | **250** | ❌ | — | 0 | **NONE** |
| **`run-dashboard.ts`** | **460** | ❌ | — | 0 | **NONE** |
| **`worktree-manager.ts`** | **150** | ❌ | — | 0 | **NONE** |
| **`event-log.ts`** | **180** | ✅ | `run-event-bus.test.ts` | 4 | Minimal |
| **`run-snapshot-cache.ts`** | **550** | ❌ | — | 0 | **NONE** |
| **`task-runner.ts`** | **430** | ✅ | Integration | 3 | Minimal |
| `blob-store.ts` | 120 | ✅ | `blob-store.test.ts` | ~6 | Good |
| `powerbar-publisher.ts` | 130 | ✅ | `powerbar-publisher.test.ts` | 6 | Good |
| `discover-agents.ts` | 120 | ✅ | `discovery.test.ts` | ~8 | Good |
| `hooks/registry.ts` | — | ✅ | `hooks.test.ts` | ~5 | Good |

### Coverage Summary

```
Total src/ modules: ~50
Tested:             ~32 (64%)
Untested:           ~18 (36%)

Critical untested (HIGH risk):
  - child-pi.ts      (380 lines) — process lifecycle, kill logic
  - team-runner.ts    (520 lines) — scheduler, adaptive planning
  - team-tool.ts      (400 lines) — 25+ action dispatch
  - state-store.ts    (250 lines) — manifest CRUD

Important untested (MEDIUM risk):
  - run-dashboard.ts       (460 lines) — UI rendering
  - run-snapshot-cache.ts  (550 lines) — caching logic
  - worktree-manager.ts    (150 lines) — git operations
  - event-log.ts           (180 lines) — event persistence
```

### Test Count Breakdown

```
Unit tests:          ~74 new (Phase 1-4) + ~30 existing = ~104
Integration tests:   46 (test/integration/)
Total:               ~150 tests
```

---

## 5. Performance Concerns

### 5.1 File-Polling Overhead

**Files**: `run-snapshot-cache.ts`, `powerbar-publisher.ts`, `crew-widget.ts`

UI components poll files mỗi 200-500ms cho active runs. Mỗi poll:
1. `stat()` manifest, tasks, agents, events, mailbox, output files
2. If stale → re-read và parse JSON
3. Build snapshot → render

**Impact**: Với 2+ active runs, mỗi tick reads 12+ files. Đã cải thiện bằng `RenderCoalescer` (Phase 1), nhưng polling vẫn là bottleneck.

**Mitigation**: Event Stream Bridge (Phase 1) bypass polling cho real-time events. Nhưng snapshot cache vẫn poll cho full state.

### 5.2 Event Log Append-Only Growth

**File**: `src/state/event-log.ts`

Events JSONL file grows unbounded. Large runs (100+ tasks) có thể produce 10,000+ events → file becomes slow to tail.

**Mitigation**: `MAX_TAIL_LINES = 500` trong snapshot cache. Nhưng file I/O vẫn O(file_size) cho append.

### 5.3 Manifest JSON Rewrite on Every Status Change

**Files**: `state-store.ts`, `team-runner.ts`

Mỗi task status change → rewrite toàn bộ `manifest.json` và `tasks.json`. Với 10 concurrent tasks updating every second → 20 full JSON serializations/sec.

**Mitigation**: Có thể dùng append-only format (JSONL) cho tasks, chỉ rewrite manifest khi structure changes.

---

## 6. Security Analysis

### ✅ Good Practices

| Area | File | Detail |
|------|------|--------|
| Path traversal | `safe-paths.ts` | Containment validation cho all file paths |
| Secret redaction | `redaction.ts` | Redacts JSON lines containing secrets |
| Depth guards | `pi-args.ts` | `checkCrewDepth()` prevents recursive spawning |
| Plan approval | `team-runner.ts` | Plan approval gate cho implementation workflow |
| Symlink containment | `safe-paths.ts` | `resolveRealContainedPath()` resolves symlinks |

### ⚠️ Concerns

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | MEDIUM | `worktree-manager.ts:107` | `JSON.parse(trimmed) as { syntheticPaths?: unknown }` — unchecked cast, could throw on malformed JSON |
| 2 | MEDIUM | `config.ts:303-405` | ~20 `as Record<string, unknown>` casts bypass type safety trong config merge |
| 3 | LOW | `task-runner.ts` | Worker stdout parsing assumes valid JSON lines — malformed lines could cause silent data loss |
| 4 | LOW | `child-pi.ts` | `killProcessTree` uses `taskkill /t /f` on Windows — potential for killing wrong processes if PID reused |

---

## 7. Code Hygiene

### 7.1 `__test__` Export Pattern

Files exporting test-only helpers (pollute public API):

| File | Exports |
|------|---------|
| `team-runner.ts` | `__test__parseAdaptivePlan`, `__test__repairAdaptivePlan`, `__test__mergeTaskUpdates` |
| `state-store.ts` | `__test__manifestCacheSize`, `__test__clearManifestCache` |
| `config/i18n.ts` | `__test__resetI18n` |
| `runtime/pi-spawn.ts` | `__test__subagentSpawnParams` |
| `utils/visual.ts` | `__test__clearVisibleWidthCache`, `__test__visibleWidthCacheSize` |

**Count**: 7+ files, 9+ exports

**Recommendation**: Move test helpers vào separate `internal` export hoặc dùng `export type` conditional pattern.

### 7.2 Config Merge Type Safety

**File**: `src/config/config.ts` (lines 303-405)

```typescript
const overrideRecord = override as Record<string, unknown>;
```

~20 unsafe casts trong config merge function. Bypass type safety cho nested config field merging.

**Recommendation**: Dùng validated schema approach (similar to oh-my-pi's `settings-schema.ts`).

### 7.3 Unused / Dead Code

| Item | File | Detail |
|------|------|--------|
| `observeStdoutChunk` | `child-pi.ts:246` | Defined but only used in mock path — creates new observer each call |
| Redundant ternary | `blob-store.ts:60` | `typeof x === "string" ? x : x` — always returns same value |
| `formatTranscriptEvent` export | `transcript-viewer.ts` | Exported but may not be imported externally |

---

## 8. Dependency Graph — Module Coupling

```
extension/register.ts (550 lines) — GOD FILE
  ├── depends on: team-tool.ts, run-dashboard.ts, crew-widget.ts,
  │               powerbar-publisher.ts, config.ts, run-event-bus.ts,
  │               state-store.ts, manifest-cache.ts, active-run-registry.ts,
  │               skill-instructions.ts, capability-inventory.ts,
  │               team-runner.ts, pi-spawn.ts, run-index.ts
  └── 20+ imports — highest coupling in codebase

team-tool.ts (400 lines)
  ├── depends on: run.ts, cancel.ts, status.ts, respond.ts, api.ts,
  │               state-store.ts, team-runner.ts, manifest-cache.ts
  └── 15+ imports

team-runner.ts (520 lines)
  ├── depends on: task-runner.ts, task-graph-scheduler.ts, state-store.ts,
  │               event-log.ts, mailbox.ts, agent-control.ts, policy.ts
  └── 12+ imports
```

`register.ts` là coupling hotspot — 20+ imports. Nên tách thành smaller registration modules.

---

## 9. Recommendations (Priority Order)

### P0 — Fix Bugs
1. Fix blob-store redundant ternary
2. Fix team-runner non-null assertion
3. Add error logging cho silent event bus catch

### P1 — Test Coverage
4. Add unit tests cho `child-pi.ts` (mock ChildProcess)
5. Add unit tests cho `team-runner.ts` (mock task execution)
6. Add unit tests cho `team-tool.ts` (action dispatch)
7. Add unit tests cho `state-store.ts` (manifest CRUD)

### P2 — Performance
8. Implement append-only tasks format (JSONL thay vì full JSON rewrite)
9. Add event log rotation/compaction cho long runs
10. Implement incremental event reading (seek to offset thay vì tail toàn bộ)

### P3 — Code Quality
11. Extract test helpers vào `internal/` exports
12. Reduce register.ts coupling — tách thành smaller registration modules
13. Validate config merge với schema thay vì unsafe casts
14. Fix worktree-manager.ts JSON parse error handling

### P4 — Architecture
15. Typed event channels (worker:progress, worker:lifecycle, worker:stream)
16. Yield tool enforcement (schema validation + retry reminders)
17. SubprocessToolRegistry pattern cho worker result extraction
18. MCP proxy tools cho child processes
