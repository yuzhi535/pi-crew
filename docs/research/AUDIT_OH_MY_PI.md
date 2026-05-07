# 🔍 Oh-My-Pi Codebase Deep Audit

> **Ngày**: 2026-05-07  
> **Phiên bản**: v14.7.3 (`e8caad723`)  
> **Codebase**: `source/oh-my-pi/` — chủ yếu `packages/coding-agent/src/`

---

## 1. Tổng quan Architecture

### End-to-End Flow

```
User Prompt → Main AgentSession → TaskTool.execute()
  ├── discoverAgents() → merge bundled + user + project agents
  ├── validate agent, check disabled/spawns
  ├── allocate unique IDs (AgentOutputManager)
  ├── For each task:
  │   ├── If isolated → create worktree/overlay → runSubprocess()
  │   └── If not → runSubprocess() in same cwd
  │       ├── createAgentSession() → new in-process AgentSession
  │       ├── Subscribe to AgentEvents → progress tracking
  │       ├── session.prompt(task) → agent loop runs
  │       ├── Wait for yield tool call (3 retries)
  │       └── Return SingleResult
  └── Merge results (patch apply or branch merge)
```

### Quyết định kiến trúc chính

1. **In-process subagents**: Chạy subagent như `AgentSession` instances trong cùng process. Tránh IPC overhead, cho phép sharing MCP connections, settings, model registry.

2. **Yield-based completion**: Subagent **phải** gọi `yield` tool đúng 1 lần. Executor gửi tối đa 3 reminders nếu agent thoát mà không yield. Contract mạnh — ngăn agent "quên" return results.

3. **Isolation backends**: 3 mode — `worktree` (git worktree), `fuse-overlay` (COW overlayfs Unix), `fuse-projfs` (ProjFS Windows). Mỗi isolated task có sandboxed filesystem view.

4. **EventBus pub/sub**: 3 channel — `task:subagent:event` (raw events), `task:subagent:progress` (aggregated), `task:subagent:lifecycle` (start/end). Decouple UI rendering từ execution.

5. **Agent discovery cascade**: Bundled → user (`~/.omp/agent/agents/*.md`) → project (`.omp/agents/*.md`) → Claude Code marketplace plugins. First name match wins.

---

## 2. Key Files & Responsibilities

### Task System Core

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `task/index.ts` | ~750 | **TaskTool class** — entry point. Agent discovery, validation, parallel execution orchestration, isolation/merge, result formatting |
| `task/executor.ts` | ~620 | **runSubprocess()** — chạy 1 subagent in-process. Progress tracking, yield handling, usage accumulation, MCP proxy tools |
| `task/types.ts` | ~230 | Core types: `AgentDefinition`, `AgentProgress`, `SingleResult`, `TaskParams`, `TaskToolDetails`, event channel constants |
| `task/agents.ts` | ~150 | Bundled agent definitions (explore, plan, designer, reviewer, librarian, task, quick_task). Parses from embedded markdown + frontmatter |
| `task/discovery.ts` | ~130 | Agent discovery từ filesystem. Merge user/project/bundled/Claude plugin agents với precedence rules |
| `task/parallel.ts` | ~100 | `mapWithConcurrencyLimit()` — worker pool với fail-fast. `Semaphore` cho async concurrency control |
| `task/worktree.ts` | ~580 | Git worktree creation/cleanup, baseline capture, patch generation/apply, branch commit/merge, nested repo handling |
| `task/render.ts` | ~1020 | TUI rendering cho task tool — call preview, result display, progress indicators, tree view, review finding badges |
| `task/template.ts` | ~40 | Renders context + assignment thành full subagent prompt dùng Handlebars templates |
| `task/subprocess-tool-registry.ts` | ~80 | Registry pattern cho extracting data từ tool events (yield, report_finding). Extensible handler system |
| `task/output-manager.ts` | ~100 | Sequential ID allocation với parent prefix support (e.g., `0-Auth.1-Subtask`). Scans existing artifacts on resume |
| `task/simple-mode.ts` | ~35 | Three modes: `default` (context + schema), `schema-free` (context only), `independent` (neither) |
| `task/isolation-backend.ts` | ~100 | Platform detection cho isolation mode (Win/Unix/ARM64), probe ProjFS availability |
| `task/name-generator.ts` | ~340 | AdjectiveNoun generator (426,710 combinations) cho human-readable task names |

### Session & Agent Runtime

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `session/agent-session.ts` | **~7500** | **Core agent session** — model management, tool dispatch, streaming, compaction, bash execution, extension runner. **GOD OBJECT** — quá lớn |
| `sdk.ts` | ~1900 | Factory cho `AgentSession` and `SessionManager`. Loads tools, skills, extensions, MCP, slash commands |
| `registry/agent-registry.ts` | ~140 | Process-global registry của live agent sessions. Dùng bởi IRC tool cho peer discovery |

### Tools

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `tools/irc.ts` | ~250 | IRC tool — agent-to-agent messaging. DM/broadcast với optional reply qua `respondAsBackground()` |
| `tools/yield.ts` | ~170 | Submit result tool. JTD/JSON Schema validation với override sau first failure. Registers subprocess handler |
| `tools/review.ts` | ~240 | `report_finding` tool cho structured code review. Priority (P0-P3), file/line tracking |

### UI Components

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `modes/components/agent-dashboard.ts` | ~900 | Interactive agent management: enable/disable, model overrides, AI-powered agent creation |
| `modes/components/session-observer-overlay.ts` | ~650 | Real-time subagent transcript viewer với expand/collapse, breadcrumb navigation, incremental file reading |
| `modes/session-observer-registry.ts` | ~140 | Tracks observable sessions, subscribes to EventBus cho lifecycle/progress updates |

### Configuration

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `config/settings-schema.ts` | ~2700 | Single source of truth cho all settings. Typed schema với UI metadata, tabs, conditions |
| `config/model-resolver.ts` | — | Model pattern resolution (agent → settings → session → fallback) |

### Tool Discovery

| File | ~Lines | Responsibility |
|------|--------|----------------|
| `tool-discovery/tool-index.ts` | ~400 | BM25-based search index over all tools. Generic `DiscoverableTool` type covers builtin, MCP, extension, custom sources |

---

## 3. Patterns đáng học hỏi cho pi-crew

### 3.1 Yield-Based Completion Contract
**File**: `tools/yield.ts`, `task/executor.ts` (lines ~380-420)

Subagent **phải** gọi `yield` đúng 1 lần. Executor:
1. Detects `yield` qua `subprocessToolRegistry` handler
2. Sends up to 3 reminder prompts nếu agent exits without yielding
3. Extracts và validates structured data từ yield result
4. Falls back to raw output parsing nếu no yield

**pi-crew takeaway**: Result collection hiện tại ad-hoc. Formal "submit result" tool với schema validation + retry reminders sẽ tăng reliability đáng kể.

### 3.2 SubprocessToolRegistry — Extensible Tool Event Handling
**File**: `task/subprocess-tool-registry.ts`

Tools register handlers cho:
- `extractData()` — pull structured data từ tool results
- `shouldTerminate()` — signal agent completion
- `renderInline()` / `renderFinal()` — custom TUI rendering

**pi-crew takeaway**: Worker result extraction có thể dùng registry pattern tương tự, cho phép different tool types contribute structured data without coupling to executor.

### 3.3 EventBus Pub/Sub cho Progress
**File**: `task/types.ts` (channel constants), `task/executor.ts` (emission)

3 dedicated channels với typed payloads tách biệt raw events, aggregated progress, lifecycle transitions. Cho phép:
- Multiple UI components subscribe independently
- Session observer gets updates without polling
- Clean separation of concerns

**pi-crew takeaway**: pi-crew đã có `RunEventBus` (từ Phase 1), nhưng chưa có typed channels. Có thể tách thành `worker:progress`, `worker:lifecycle`, `worker:stream`.

### 3.4 Isolation Backends — FUSE/ProjFS
**File**: `task/isolation-backend.ts`, `task/worktree.ts`

3 isolation modes:
- `worktree` — git worktree per task (cross-platform)
- `fuse-overlay` — Copy-on-Write overlayfs (Unix)
- `fuse-projfs` — Windows ProjFS

**pi-crew takeaway**: Chỉ có worktree. Thêm FUSE/ProjFS isolation cho environments cần true filesystem isolation.

### 3.5 Agent Dashboard — Interactive Configuration UI
**File**: `modes/components/agent-dashboard.ts` (~900 lines)

Full interactive UI cho agent management:
- Enable/disable agents
- Model override per agent
- AI-powered agent creation (nhập description → generate agent)
- Source filtering (builtin/user/project)

**pi-crew takeaway**: pi-crew đã có `agent-management-overlay.ts` (read-only). Cần thêm enable/disable toggle + model override editing.

### 3.6 Session Observer — Incremental Transcript Reading
**File**: `modes/components/session-observer-overlay.ts` (~650 lines)

- Incremental JSONL reading (không load toàn bộ file)
- Expand/collapse per entry
- Breadcrumb navigation cho nested subagent transcripts
- Auto-scroll to bottom unless user scrolled up

**pi-crew takeaway**: pi-crew đã có `transcript-entries.ts`. Cần thêm breadcrumb navigation + incremental reading.

### 3.7 Name Generator — Human-Readable Task Names
**File**: `task/name-generator.ts` (~340 lines)

`AdjectiveNoun` generator → 426,710 combinations. Thay vì `task_01`, dùng `BraveFalcon`. Dễ nhận diện trong UI.

**pi-crew takeaway**: pi-crew dùng task IDs như `01_discover`. Human-readable names sẽ tốt hơn cho UX.

### 3.8 Semaphore Concurrency Control
**File**: `task/parallel.ts`

```typescript
class Semaphore {
  private queue: (() => void)[] = [];
  private running = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> { ... }
  release(): void { ... }
}
```

Clean async concurrency primitive. pi-crew dùng `mapConcurrent` từ `parallel-utils.ts` — tương đương nhưng Semaphore explicit hơn.

### 3.9 Handlebars Template Rendering
**File**: `task/template.ts`

Handlebars templates cho subagent prompts. Cho phép customization dễ dàng.

**pi-crew takeaway**: pi-crew dùng string concatenation trong `prompt-builder.ts`. Templates sẽ dễ maintain hơn.

### 3.10 MCP Proxy Tools
**File**: `task/executor.ts` (~line 280)

Subagents reuse parent's MCP connections qua `createMCPProxyTools()`. Tránh mỗi subagent phải setup riêng.

**pi-crew takeaway**: pi-crew chưa có MCP proxy. Mỗi child Pi process tự discover MCP connections. Thêm proxy sẽ giảm startup time.

---

## 4. Anti-patterns & Vấn đề trong oh-my-pi

### 4.1 God Object — `agent-session.ts` (~7500 lines)
Một file duy nhất chứa model management, tool dispatch, streaming, compaction, bash execution, extension runner. Quá khó maintain. Nên tách thành multiple modules.

### 4.2 No Process Isolation
Crashed subagent → potential full process crash. Không có fault boundary. pi-crew's child process approach an toàn hơn cho production.

### 4.3 Settings Schema Monolith — `settings-schema.ts` (~2700 lines)
Single source of truth cho all settings, nhưng 2700 dòng là quá lớn. Nên tách theo domain (agent settings, UI settings, task settings, etc.).

### 4.4 Hardcoded Bundled Agents
`task/agents.ts` embeds agent definitions as multiline string literals. Khó edit, khó test. pi-crew's file-based approach (agents/*.md) linh hoạt hơn.

---

## 5. Recent Changes (git log)

```
e8caad723 feat: v14.7.3
... (56 commits since v14.6.6)
```

Key changes since last review:
- Isolation backend improvements (ProjFS support)
- Agent dashboard UI enhancements
- Yield tool schema validation improvements
- IRC tool anti-deadlock side-channel
- Session observer incremental reading
- BM25 tool discovery index

---

## 6. Feature Matrix (so với pi-crew)

| Feature | oh-my-pi | pi-crew | Gap |
|---------|:--------:|:-------:|-----|
| In-process execution | ✅ | ❌ | pi-crew dùng child process |
| Process isolation | ❌ | ✅ | oh-my-pi crash cascade risk |
| Yield tool enforcement | ✅ | ❌ | pi-crew cần implement |
| IRC messaging | ✅ | ❌ | pi-crew chỉ có mailbox |
| Broadcast messaging | ✅ | ❌ | pi-crew không có |
| Steering mid-turn | ✅ | ❌ | pi-crew chỉ cancel/respond |
| EventBus typed channels | ✅ | 🔶 | pi-crew có RunEventBus nhưng chưa typed |
| FUSE/ProjFS isolation | ✅ | ❌ | pi-crew chỉ worktree |
| Agent dashboard UI | ✅ | 🔶 | pi-crew có read-only overlay |
| Session observer | ✅ | 🔶 | pi-crew có transcript-entries |
| MCP proxy | ✅ | ❌ | pi-crew mỗi child tự discover |
| Human-readable task names | ✅ | ❌ | pi-crew dùng IDs |
| Handlebars templates | ✅ | ❌ | pi-crew dùng string concat |
| Adaptive planning | ❌ | ✅ | oh-my-pi không có |
| Retry policy | ❌ | ✅ | oh-my-pi chỉ yield reminder |
| Policy engine | ❌ | ✅ | oh-my-pi không có |
| Crash recovery | ❌ | ✅ | oh-my-pi không có |
| Dependency context | ❌ | ✅ | oh-my-pi chỉ context.md |
| Effectiveness guard | ❌ | ✅ | oh-my-pi không có |
| Deadletter tracking | ❌ | ✅ | oh-my-pi không có |
