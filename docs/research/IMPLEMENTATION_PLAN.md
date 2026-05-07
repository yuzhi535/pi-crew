# Pi-Crew Improvement Plan — 14 Enhancements from oh-my-pi

## Tổng quan

14 cải tiến được chia thành 4 phases. Mỗi phase có thể thực hiện độc lập,
không conflict file với nhau (trừ khi ghi chú).

---

## Phase 1: Quick Wins (3-4 ngày)
> Chất lượng cuộc sống, ít risk, ảnh hưởng ngay

### 1.2 Orchestration Skill
**Mục tiêu**: Tạo orchestration skill cho planner/executor, ép orchestrator làm việc hiệu quả hơn.

**Files tạo/sửa**:
- `skills/orchestration/SKILL.md` — TẠO MỚI (prompt template)
- `skills/orchestration/SKILL.md` — TẠO MỚI

**Chi tiết**:
- Nội dung dựa trên oh-my-pi `orchestrate.md` pattern
- Bao gồm: rules (parallelize, verify, respawn), workflow (ingest → plan → dispatch → verify → commit → advance), anti-patterns
- Điều chỉnh cho pi-crew context: dùng `task` subagent thay vì trực tiếp edit, dùng mailbox cho coordination
- Thêm `orchestration` vào default skills cho planner role trong `src/runtime/skill-instructions.ts`

**Test**: Manual — chạy team run với orchestration skill, verify planner output quality

---

### 1.3 `/retry` Manual Retry Command
**Mục tiêu**: Thêm slash command cho phép retry failed/aborted tasks thủ công.

**Files tạo/sửa**:
- `src/extension/registration/commands.ts` — thêm `team-retry` command
- `src/extension/team-tool/cancel.ts` — thêm `handleRetry` function

**Chi tiết**:
- Command: `/team-retry <runId> [taskId]`
- Logic:
  1. Load manifest, tìm task failed/aborted
  2. Nếu chỉ định taskId → retry task đó, set status về "queued"
  3. Nếu không chỉ định → retry tất cả failed/aborted tasks
  4. Reset task metadata (error, finishedAt, terminalEvidence)
  5. Execute hook `before_retry` (nếu có)
  6. Re-run task qua `runTeamTask()`
- Pre-check: ownership, run không đang active
- Result message: "Retried N task(s) in run X"

**Test**: Unit test trong `test/unit/` — mock manifest với failed task, verify reset + re-run

---

### 1.9 Intent Text trên Team Tool Actions
**Mục tiêu**: Mỗi team tool action (run, cancel, status, etc.) trả về intent text hiển thị trong powerbar.

**Files tạo/sửa**:
- `src/extension/team-tool/context.ts` — thêm `intentText` vào result metadata
- `src/extension/team-tool/run.ts` — thêm intent: `"running {team} team for: {goal[:60]}"`
- `src/extension/team-tool/cancel.ts` — thêm intent: `"cancelling run {runId}"`
- `src/extension/team-tool/status.ts` — thêm intent: `"checking status of run {runId}"`
- `src/extension/team-tool/respond.ts` — thêm intent: `"responding to task {taskId}"`
- `src/ui/powerbar-publisher.ts` — hiển thị intent text khi có

**Chi tiết**:
- Mỗi action function thêm `intent` field vào result metadata
- Powerbar segment hiển thị intent text (truncate 60 chars)
- Intent chỉ xuất hiện khi action đang chạy, không persist

**Test**: Unit test — verify mỗi action trả về đúng intent text

---

## Phase 2: Worker Efficiency (3-4 ngày)
> Tăng hiệu suất worker, giảm context waste

### 2.5 Workspace Tree Context Injection
**Mục tiêu**: Inject compact directory tree vào worker prompt để worker hiểu project structure mà không cần explore.

**Files tạo/sửa**:
- `src/runtime/workspace-tree.ts` — TẠO MỚI
- `src/runtime/task-runner/prompt-builder.ts` — thêm tree block vào prompt
- `src/runtime/task-runner.ts` — gọi buildWorkspaceTree trước khi render prompt

**Chi tiết**:
- `buildWorkspaceTree(cwd, options)`:
  - `maxDepth: 3`, `directoryEntryLimit: 12`, `lineCap: 120`
  - Skip: node_modules, .git, dist, build, target, .venv, .cache
  - Sort by mtime (recency)
  - Output format: indented list với size + age
  - Async, trả về string hoặc "" nếu lỗi
- Trong `renderTaskPrompt()`:
  - Thêm section `# Workspace Structure` sau worker context
  - Cache tree per-cwd (TTL 30s) để không rebuild cho mỗi task
- Option: chỉ inject khi task có `injectWorkspaceTree: true` hoặc khi role là explorer/executor

**Test**: Unit test — tạo temp dir structure, verify output format và truncation

---

### 2.8 Cache-Stable Worker Prompts
**Mục tiêu**: Tách worker prompts thành stable prefix + dynamic suffix để tối ưu KV-cache reuse.

**Files tạo/sửa**:
- `src/runtime/task-runner/prompt-builder.ts` — refactor prompt structure
- `src/runtime/skill-instructions.ts` — tách skill block ra riêng

**Chi tiết**:
- Prompt structure hiện tại: 1 big system message
- Refactor thành:
  1. **Stable prefix**: role instructions, coordination contract, workspace tree (ít thay đổi giữa tasks)
  2. **Dynamic suffix**: task-specific goal, dependency context, skill instructions (thay đổi mỗi task)
- `renderTaskPrompt()` trả về `{ stablePrefix: string, dynamicSuffix: string }`
- `runChildPi()` ghép 2 phần, hoặc gửi riêng nếu provider hỗ trợ multi-system-messages
- Đo lường: verify cache hit rate tăng khi chạy cùng team nhiều tasks

**Test**: Unit test — verify prompt structure, verify stable prefix giống nhau giữa 2 tasks cùng role

---

### 2.9 (tiếp) Intent trên powerbar — hoàn thiện
Xem 1.9 ở Phase 1.

---

## Phase 3: Token Optimization (4-5 ngày)
> Giảm token usage, chỉ load những gì cần

### 3.1 Tool LoadMode Pattern
**Mục tiêu**: Phân loại tools thành "essential" (luôn load) vs "discoverable" (chỉ load khi cần), giảm prompt size cho workers.

**Files tạo/sửa**:
- `src/runtime/role-permission.ts` — thêm `loadMode` vào tool definitions
- `src/runtime/task-runner/prompt-builder.ts` — chỉ inject prompt snippets cho essential tools
- `src/runtime/capability-inventory.ts` — track discoverable tools
- `src/runtime/skill-instructions.ts` — thêm `search_tool_bm25` khi có discoverable tools

**Chi tiết**:
- Tool classification:
  - **Essential** (luôn active): `bash`, `read`, `edit`, `write` (cho read-write roles)
  - **Discoverable** (ẩn): `github`, `browser`, `ast-grep`, `ast-edit`, `calculator`, `render-mermaid`, etc.
- Role-level override: explorer chỉ cần `read` essential, executor cần `bash` + `read` + `edit`
- Khi có discoverable tools:
  - Inject `search_tool_bm25` tool vào available tools
  - Thêm instruction: "Some tools are hidden. Use search_tool_bm25 to discover them."
- Worker sees: fewer tool definitions → smaller prompt → more context room

**Test**: Unit test — verify role permissions, verify discoverable tools excluded from prompt

---

### 3.7 BM25 Agent Discovery
**Mục tiêu**: Thêm BM25 search cho agent discovery — tìm agent phù hợp nhất theo task description.

**Files tạo/sửa**:
- `src/agents/agent-search.ts` — TẠO MỚI
- `src/agents/discover-agents.ts` — thêm search capability
- `src/runtime/task-runner.ts` — sử dụng agent search khi auto-select agent

**Chi tiết**:
- `buildAgentSearchIndex(agents)`:
  - BM25 trên fields: name (6x), label (4x), description (2x), tags (1x)
  - Reuse BM25 implementation từ `src/skills/discover-skills.ts` (hoặc extract shared)
- `searchAgents(index, query, limit)` → ranked agent list
- Khi task không chỉ định agent, hệ thống có thể:
  1. Extract keywords từ task description
  2. Search top 3 agents
  3. Auto-select best match hoặc suggest cho planner
- Integration: trong `handleRun()` khi `params.agent` không set

**Test**: Unit test — tạo test agents, verify search ranking

---

### 3.13 Agent-as-Markdown Frontmatter Enhancement
**Mục tiêu**: Thêm frontmatter fields vào agent config: `loadMode`, `defaultTools`, `contextMode`.

**Files tạo/sửa**:
- `src/agents/agent-config.ts` — thêm fields vào AgentConfig type
- `src/agents/agent-serializer.ts` — parse/serialize new fields
- `src/runtime/task-runner.ts` — respect loadMode và defaultTools

**Chi tiết**:
- New frontmatter fields:
  ```yaml
  ---
  name: explorer
  description: Fast codebase discovery
  loadMode: essential    # "essential" | "discoverable"
  defaultTools: [read, bash, find]
  contextMode: fresh     # "fresh" | "fork"
  ---
  ```
- `AgentConfig` thêm optional fields
- `renderTaskPrompt()` respects `defaultTools` — chỉ inject specified tools
- `loadMode` maps sang 3.1's loadMode pattern
- Default values: `loadMode: "essential"`, `defaultTools: null` (all tools)

**Test**: Unit test — parse frontmatter với new fields, verify defaults

---

## Phase 4: Advanced Features (5-7 ngày)
> Tính năng nâng cao, cần nhiều effort hơn

### 4.4 Streaming Preview cho Worker Output
**Mục tiêu**: Hiển thị preview worker output (file changes) trong TUI khi worker đang chạy.

**Files tạo/sửa**:
- `src/ui/worker-preview.ts` — TẠO MỚI
- `src/runtime/task-runner.ts` — capture streaming output events
- `src/ui/powerbar-publisher.ts` — integrate preview

**Chi tiết**:
- Khi worker emit JSON events (tool calls, edits), capture và render preview
- Preview formats:
  - Write tool: hiển thị last 12 lines với line numbers + syntax highlight
  - Bash tool: hiển thị last 10 lines output
  - Edit tool: hiển thị diff summary
- Powerbar segment mở rộng khi có preview content
- Fallback: nếu TUI không support, chỉ hiển thị spinner như hiện tại
- Streaming events parse từ child Pi JSONL output (đã có `parsePiJsonOutput`)

**Test**: Unit test — mock streaming events, verify preview format

---

### 4.6 Structural Code Summary
**Mục tiêu**: Tạo code summarization capability cho explorer/reviewer roles — đọc structure thay vì toàn bộ file.

**Files tạo/sửa**:
- `src/runtime/code-summary.ts` — TẠO MỚI (TypeScript fallback)
- `src/runtime/task-runner/prompt-builder.ts` — inject summary thay vì raw content (optional)

**Chi tiết**:
- **Option A** (JS-only): Regex-based summary cho common patterns (functions, classes, imports)
  - Parse: export/function/class/interface/type declarations
  - Elide: function bodies, long arrays, block comments
  - Output: kept/elided segments
- **Option B** (Rust native): Gọi `@oh-my-pi/pi-natives` `summarize_code` nếu available
  - Check: `try { await import("@oh-my-pi/pi-natives") } catch {}`
  - Fallback to Option A nếu native không available
- Integration:
  - Explorer role: default inject summaries thay vì raw files
  - Reviewer role: inject summaries + diff context
  - Executor role: vẫn dùng raw files (cần exact content để edit)
- Config: `agent.summaryMode: "off" | "structure" | "full"` trong frontmatter

**Test**: Unit test — verify summary output cho sample TS/Rust/Python files

---

### 4.10 Task Diff API
**Mục tiêu**: Expose API để external consumers xem diff của những gì worker đã thay đổi.

**Files tạo/sửa**:
- `src/extension/team-tool/api.ts` — thêm `diff` action
- `src/extension/team-tool/inspect.ts` — thêm diff display

**Chi tiết**:
- New API action: `team api diff <runId> [taskId]`
- Logic:
  1. Load manifest, tìm diff artifacts (từ worktree mode hoặc file snapshots)
  2. Nếu worktree: chạy `git diff` trong worktree
  3. Nếu không: đọc stored diff artifact
  4. Format: unified diff + summary stats
- Team tool inspect: thêm diff section vào inspect output
- Powerbar: hiển thị diff stats khi task completes

**Test**: Unit test — mock diff artifacts, verify formatting

---

### 4.11 Notebook-Aware Path Handling
**Mục tiêu**: Support `.ipynb` files trong workers — parse cells, edit individual cells.

**Files tạo/sửa**:
- `src/runtime/notebook-helpers.ts` — TẠO MỚI
- `src/runtime/task-runner/prompt-builder.ts` — inject notebook instructions

**Chi tiết**:
- `parseNotebook(path)` → cells array
- `readNotebookCell(path, index)` → cell content
- `editNotebookCell(path, index, content)` → update cell
- Worker instructions: "For .ipynb files, use notebook helpers instead of raw read/write"
- Edge case: handle malformed notebooks gracefully

**Test**: Unit test — tạo sample .ipynb, verify parse/edit

---

### 4.12 Shared SSE Utility
**Mục tiêu**: Extract SSE parser cho potential future use (streaming dashboard, external integrations).

**Files tạo/sửa**:
- `src/utils/sse-parser.ts` — TẠO MỚI

**Chi tiết**:
- `readSseEvents(stream, signal)` → async generator of `ServerSentEvent`
- Handles: `\r\n`, `\n`, multi-line data, event types, `[DONE]` sentinel
- `readSseJson(stream, signal)` → wrapper parse JSON data
- Reusable cho:
  - Future: streaming task status endpoint
  - Future: external dashboard integration
  - Current: không dùng ngay, nhưng available

**Test**: Unit test — verify SSE parsing cho various input formats

---

### 4.14 Control Notices Enhancement
**Mục tiêu**: Mở rộng attention tracking: consecutive tool failures, per-task thresholds, notification routing.

**Files tạo/sửa**:
- `src/runtime/agent-control.ts` — thêm control types
- `src/runtime/crew-agent-records.ts` — track tool failure counts
- `src/extension/notification-router.ts` — thêm notification channels

**Chi tiết**:
- New control events:
  - `consecutive_tool_failures`: track N consecutive failed tool calls per task
  - `long_running`: alert khi task chạy quá X minutes (configurable)
  - `no_file_mutations`: alert khi implementation role completes without any file changes
- New config fields:
  ```json
  {
    "control": {
      "consecutiveFailureThreshold": 3,
      "longRunningMinutes": 10,
      "mutationGuardRoles": ["executor", "worker"]
    }
  }
  ```
- Notification routing:
  - `event`: append event (current behavior)
  - `attention`: set activityState = "needs_attention" (current)
  - `notify`: dispatch external notification (future: webhook, Slack)
- Integration: control check chạy trong `applyAttentionState()` — thêm checks mới

**Test**: Unit test — verify consecutive failure detection, long-running detection

---

## Dependency Graph

```
Phase 1 (independent):
  1.2 Orchestration ─┐
  1.3 Retry          ├─→ không phụ thuộc nhau
  1.9 Intent         ─┘

Phase 2 (light dependencies):
  2.5 Workspace Tree ──→ 2.8 Cache-Stable Prompts (tree là stable prefix candidate)

Phase 3 (sequential):
  3.13 Agent Frontmatter ──→ 3.1 Tool LoadMode ──→ 3.7 BM25 Agent Discovery
  (frontmatter định nghĩa loadMode) (loadMode cần agent search khi auto-select)

Phase 4 (independent):
  4.4 Streaming Preview
  4.6 Code Summary
  4.10 Task Diff API
  4.11 Notebook Helpers
  4.12 SSE Parser
  4.14 Control Notices
```

## Execution Timeline

| Week | Phase | Deliverables |
|------|-------|-------------|
| 1 | Phase 1 | Orchestration skill + Retry command + Intent text |
| 1-2 | Phase 2 | Workspace tree + Cache-stable prompts |
| 2-3 | Phase 3 | Agent frontmatter + LoadMode + BM25 agent search |
| 3-4 | Phase 4 | Streaming preview + Code summary + Diff API + Control notices |
| 4 | Phase 4 | Notebook + SSE parser (lower priority) |

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Tool loadMode breaking existing workflows | Default: tất cả tools essential (backward compatible) |
| BM25 agent search chọn sai agent | Fallback: giữ hiện tại behavior khi search score thấp |
| Code summary mất info quan trọng | Configurable: chỉ dùng cho explorer/reviewer, không phải executor |
| Streaming preview phức tạp | Phase 4, chỉ implement khi Phase 1-3 ổn định |
| Workspace tree too large cho context | Hard lineCap: 120 lines, only inject khi config bật |
