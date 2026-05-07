# 🔬 Deep Research: Oh-My-Pi Subagent Architecture

> **Nguồn**: Đọc sâu trực tiếp source code oh-my-pi v14.7.3 + 6 parallel research agents (4 explorer shards + 1 analyst + 1 writer)
> **Mục đích**: Hiểu cách hoạt động subagent, giao tiếp giữa các subagent, và UI hiển thị
> **Files đã kiểm tra**: 16 files chính (~8000+ dòng code)

---

## 1. Subagent Lifecycle & Execution

### 1.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Main Session                          │
│  (AgentSession)                                         │
│  ├─ TaskTool.execute()                                  │
│  │   ├─ #executeSync()  ← sequential/sync path         │
│  │   └─ execute() async ← async background path        │
│  │                                                      │
│  │   ┌─────────────┐  ┌─────────────┐                  │
│  │   │ runSubprocess│  │ runSubprocess│  ← parallel     │
│  │   │ (task 0)     │  │ (task 1)     │    via          │
│  │   │  AgentSession│  │  AgentSession│  Semaphore      │
│  │   │  + Events    │  │  + Events    │    + mapWith... │
│  │   └─────────────┘  └─────────────┘                  │
│  └─ EventBus                                            │
│     ├─ task:subagent:event     (raw events)             │
│     ├─ task:subagent:progress  (aggregated)             │
│     └─ task:subagent:lifecycle (start/end)              │
└─────────────────────────────────────────────────────────┘
```

### 1.2 In-Process Execution Model (KHÔNG phải child process!)

**Key insight**: Oh-my-pi subagents chạy **in-process** (cùng process), KHÔNG spawn child process như pi-crew.

**File**: `packages/coding-agent/src/task/executor.ts` (~1291 lines)

```typescript
// executor.ts — runSubprocess creates an AgentSession IN-PROCESS
const { session } = await createAgentSession({
  cwd: worktree ?? cwd,
  authStorage, modelRegistry, settings: subagentSettings,
  model, thinkingLevel: effectiveThinkingLevel,
  toolNames,        // ← restricted tool set
  systemPrompt: ...,  // ← composed prompt
  sessionManager,     // ← in-memory or file-backed
  hasUI: false,       // ← no UI for subagents
  spawns: spawnsEnv,  // ← recursion control
  taskDepth: childDepth,
});
```

### 1.3 Agent Definition & Discovery

**File**: `packages/coding-agent/src/task/agents.ts`

- **Bundled agents**: Embedded via `import ... with { type: "text" }` (Bun compile-time)
  - explore, plan, designer, reviewer, librarian, task, quick_task
- **User agents**: `~/.omp/agent/agents/*.md`
- **Project agents**: `.omp/agents/*.md`
- **Frontmatter** (YAML): `name, description, tools?, spawns?, model?, thinkingLevel?, blocking?, output?`

**File**: `packages/coding-agent/src/task/types.ts`
```typescript
interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];        // ← tool whitelist
  spawns?: string[] | "*"; // ← recursion control
  model?: string[];        // ← model pattern override
  thinkingLevel?: ThinkingLevel;
  blocking?: boolean;       // ← prevent async execution
  output?: unknown;         // ← JTD output schema
  source: AgentSource;
  filePath?: string;
}
```

### 1.4 System Prompt Construction

**File**: `packages/coding-agent/src/task/executor.ts`

```
Subagent system prompt = template.render(subagentSystemPromptTemplate, {
  base: defaultPrompt,           // ← Pi's default system prompt
  agent: agent.systemPrompt,     // ← agent-specific instructions
  worktree: worktree ?? "",      // ← isolation directory
  outputSchema: ...,             // ← expected output format
  contextFile: ...,              // ← parent conversation context
  ircPeers: ...,                 // ← visible IRC peers
  ircSelfId: ...,                // ← self agent ID for IRC
})
```

### 1.5 Tool Access Control

```typescript
// Restricted tool set from agent definition
let toolNames: string[] | undefined;
if (agent.tools && agent.tools.length > 0) {
  toolNames = agent.tools;
  // Auto-include task tool if spawns defined
  if (agent.spawns !== undefined && !toolNames.includes("task") && !atMaxDepth) {
    toolNames = [...toolNames, "task"];
  }
}

// Recursion depth limit
const maxRecursionDepth = settings.get("task.maxRecursionDepth") ?? 2;
if (atMaxDepth && toolNames?.includes("task")) {
  toolNames = toolNames.filter(name => name !== "task");
}
```

### 1.6 Yield Tool Pattern (Critical!)

Subagents **MUST** call `yield` tool to submit results:

```typescript
// executor.ts — yield enforcement
const MAX_YIELD_RETRIES = 3;
while (!yieldCalled && retryCount < MAX_YIELD_RETRIES && !abortSignal.aborted) {
  const reminder = prompt.render(submitReminderTemplate, {
    retryCount, maxRetries: MAX_YIELD_RETRIES,
  });
  await session.prompt(reminder, {
    attribution: "agent",
    ...(reminderToolChoice ? { toolChoice: reminderToolChoice } : {}),
  });
  await session.waitForIdle();
}
```

If subagent exits without calling yield → warning + potential exitCode=1.

### 1.7 Progress Tracking

**Coalesced progress updates** (150ms debounce):

```typescript
const PROGRESS_COALESCE_MS = 150;

// Events tracked per-subagent:
progress.currentTool = event.toolName;
progress.currentToolArgs = extractToolArgsPreview(event.args);
progress.recentTools.unshift({ tool, args, endMs });
progress.tokens += getUsageTokens(messageUsage);
progress.recentOutput = lines.slice(-8).reverse();  // 8 recent output lines
```

### 1.8 Isolation Modes

```typescript
type IsolationMode = "worktree" | "fuse-overlay" | "fuse-projfs" | "none";
type MergeMode = "patch" | "branch" | "none";
type CommitStyle = "ai" | "simple";
```

- **worktree**: Git worktree per task → capture patch or branch
- **fuse-overlay**: FUSE filesystem overlay (fast copy-on-write)
- **fuse-projfs**: Windows ProjFS overlay
- **none**: No isolation, in-place editing

---

## 2. Inter-Subagent Communication

### 2.1 IRC Tool — Agent-to-Agent Messaging

**File**: `packages/coding-agent/src/tools/irc.ts`

Oh-my-pi has a full **IRC-like messaging system** between agents:

```
┌──────────────┐    irc.send    ┌──────────────┐
│  Agent A     │ ─────────────→ │  Agent B     │
│  (subagent)  │    message     │  (subagent)  │
│              │ ←───────────── │              │
│              │   auto-reply   │              │
└──────────────┘                └──────────────┘
        ↓                               ↓
  relay to Main                  relay to Main
  (display only)                (display only)
```

**Operations**:
- `op: "list"` → list visible peers
- `op: "send"` → send message to peer or broadcast ("all")
- `awaitReply: true/false` → DM auto-replies, broadcast doesn't

### 2.2 AgentRegistry — Global Process Registry

**File**: `packages/coding-agent/src/registry/agent-registry.ts`

```typescript
class AgentRegistry {
  // Process-global singleton
  static global(): AgentRegistry;

  register(input: RegisterInput): AgentRef;  // register at creation
  unregister(id: string): void;              // remove on dispose
  setStatus(id: string, AgentStatus): void;
  listVisibleTo(id: string): AgentRef[];     // peers visible to caller
}
```

- Main agent: id="0-Main", kind="main"
- Subagents: id="0-TaskName", kind="sub", parentId="0-Main"

### 2.3 Ephemeral Side-Channel (Anti-Deadlock!)

**File**: `packages/coding-agent/src/session/agent-session.ts`

```typescript
async respondAsBackground(args): Promise<{ replyText: string | null }> {
  // 1. Create incoming record (irc:incoming)
  // 2. Forward to Main UI for display (relay)
  // 3. Run ephemeral turn: snapshot current model+history, no tools, no persistence
  //    → avoids deadlock with recipient's in-flight tool calls
  // 4. Create reply record (irc:autoreply)
  // 5. Queue both records for injection into recipient's history (deferred until idle)
}

async runEphemeralTurn(args): Promise<{ replyText, assistantMessage }> {
  // Snapshot includes in-flight streaming text!
  const snapshot = this.#buildEphemeralSnapshot(args.promptText);
  const llmMessages = await this.convertMessagesToLlm(snapshot, args.signal);
  // ... stream response, no tools, no history mutation
}
```

**Key design**: The side-channel does NOT require the recipient's main loop to be free. It takes a snapshot of the current history (including any in-flight streaming text) and generates a reply in parallel.

### 2.4 IRC Relay to Main

All IRC exchanges are **relayed to the main agent's UI** (display-only, not persisted to main's history):

```
Subagent A sends to Subagent B:
  → Main UI shows: [IRC `AgentA` → `AgentB`] message...
  → Main UI shows: [IRC `AgentB` → (auto) `AgentA`] reply...
```

### 2.5 EventBus Channels

Three channels for subagent events:

| Channel | Purpose | Payload |
|---------|---------|---------|
| `task:subagent:event` | Raw agent events (tool calls, messages) | `{ index, agent, event }` |
| `task:subagent:progress` | Aggregated progress (debounced 150ms) | `SubagentProgressPayload` |
| `task:subagent:lifecycle` | Start/end transitions | `SubagentLifecyclePayload` |

### 2.6 Communication Summary

```
Method          │ Direction         │ Persistence      │ Use Case
────────────────┼───────────────────┼──────────────────┼──────────────────
IRC tool        │ peer ↔ peer       │ queued on idle   │ Coordination
EventBus        │ child → parent    │ in-memory only   │ Progress tracking
Session file    │ child → parent    │ .jsonl on disk   │ Transcript
Artifacts       │ child → parent    │ files on disk    │ Output/patches
Context file    │ parent → child    │ .md on disk      │ Parent context
Yield tool      │ child → parent    │ in output        │ Submit results
```

---

## 3. TUI/UI Rendering for Subagents

### 3.1 Session Observer Registry

**File**: `packages/coding-agent/src/modes/session-observer-registry.ts`

```
SessionObserverRegistry
  ├─ subscribeToEventBus(eventBus)
  │   ├─ on(TASK_SUBAGENT_LIFECYCLE_CHANNEL) → track start/end
  │   └─ on(TASK_SUBAGENT_PROGRESS_CHANNEL) → update progress
  ├─ onChange(callback) → notify UI to re-render
  ├─ getSessions() → sorted list [main, ...subagents]
  └─ getActiveSubagentCount()
```

Tracks `ObservableSession[]`:
```typescript
interface ObservableSession {
  id: string;
  kind: "main" | "subagent";
  label: string;
  agent?: string;
  status: "active" | "completed" | "failed" | "aborted";
  sessionFile?: string;     // ← JSONL transcript path
  lastUpdate: number;
  progress?: AgentProgress; // ← latest progress snapshot
}
```

### 3.2 Session Observer Overlay (Main UI Component)

**File**: `packages/coding-agent/src/modes/components/session-observer-overlay.ts` (~824 lines)

**Architecture**:
```
┌─ DynamicBorder ──────────────────────────────────────────┐
│ Session Observer > Subagent #0                           │
│ fix-security-bug [active] explorer                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ▶ ▸ bash                                                │
│      npm run test                                        │
│      ✓ done                                              │
│                                                          │
│    ▸ read                                                │
│      path: src/auth.ts                                   │
│      ✓ 24 lines                                          │
│                                                          │
│  ▶ Response                                              │
│      I found the security issue in...                    │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ 12 tools · 8.5k tokens · 2m 34s  [1-45/89]              │
│ j/k:scroll Enter:expand [/]/←→:cycle Esc:close          │
└─ DynamicBorder ──────────────────────────────────────────┘
```

**Key UI Features**:

1. **Auto-jump to most recent active subagent** on open
2. **Incremental transcript loading**: reads JSONL file incrementally (`readFileIncremental`) — only reads new bytes since last render
3. **Entry-based selection**: each thinking/text/toolCall/user block is a selectable entry
4. **Expand/collapse**: Enter toggles expanded view per entry
5. **Breadcrumb navigation**: for nested sub-agents (subagent spawning subagent)
6. **Cycle agents**: `]`/`[` or ←→ to switch between subagents
7. **Auto-scroll**: stays at bottom unless user manually scrolled up
8. **Markdown rendering**: expanded entries use `Markdown` component for rich formatting
9. **Smart scrolling**: entries larger than viewport only snap when completely out of view

### 3.3 Anti-Flicker Techniques

1. **Progress coalescing** (150ms debounce in executor.ts):
   ```typescript
   const PROGRESS_COALESCE_MS = 150;
   // Only emit progress if 150ms elapsed since last emit
   ```

2. **Incremental file reading** (only new bytes):
   ```typescript
   readFileIncremental(filePath, fromByte) → { text, newSize }
   ```

3. **Viewport-based rendering**: only renders visible lines in viewport, pads rest
4. **Rebuild on state change only**: content rebuilt only when selection/expansion changes

### 3.4 Agent Dashboard (Configuration UI)

**File**: `packages/coding-agent/src/modes/components/agent-dashboard.ts` (~1120 lines)

Two-column layout for managing agents:
- Left: agent list with search/filter by source (All/Project/User/Bundled)
- Right: inspector showing model resolution, overrides, file path
- Can create new agents via AI generation (architect agent)
- Toggle enable/disable, model override per agent

### 3.5 Render Chain for Subagent Progress

```
AgentEvent (in subagent session)
  → processEvent() [executor.ts]
    → AgentProgress updated in-memory
    → scheduleProgress() with 150ms coalesce
      → EventBus.emit(TASK_SUBAGENT_PROGRESS_CHANNEL)
        → SessionObserverRegistry updates ObservableSession
          → onChange listeners fire
            → UI re-renders observer overlay
```

### 3.6 Streaming Text Display

From executor.ts `processEvent`:
```typescript
case "message_update":
  if (assistantEvent.type === "text_delta") {
    appendRecentOutputTail(assistantEvent.delta);  // incremental
  }
```

The observer overlay reads the full JSONL transcript from disk, so it shows the complete conversation, not just the last delta.

---

## 4. Steering & Follow-up (Từ agent research)

### 4.1 Steering Mechanism

**Files**: `packages/agent/src/agent.ts` (line 220-580), `packages/agent/src/agent-loop.ts`

```
agent.steer(message)  → thêm vào #steeringQueue
agent.followUp(message) → thêm vào #followUpQueue

Agent Loop:
  while (true) {                              // outer loop: follow-ups
    while (hasMoreToolCalls || pendingMessages) { // inner loop
      // inject pending messages từ steering queue
      // check interruptMode: "immediate" (sau mỗi tool) hoặc "wait" (đợi turn xong)
    }
  }
```

Hai chế độ interrupt:
- `"immediate"`: kiểm tra steering queue sau mỗi tool call → phản hồi nhanh
- `"wait"`: đợi turn hiện tại hoàn tất → không gián đoạn

### 4.2 render.ts — Task Tool TUI Rendering (~1020 lines)

**File**: `packages/coding-agent/src/task/render.ts`

Component hiển thị kết quả task tool trong main session transcript:
- `renderCall()`: Hiển thị khi parent gọi task tool (tóm tắt agent, tasks, isolation mode)
- `renderResult()`: Hiển thị kết quả khi subagent hoàn thành
  - Per-task status indicators (✓/✗/⊘)
  - Duration, token counts
  - Truncated output previews
  - Patch/merge summaries
  - Usage aggregation across all subagents

---

## 5. Key Differences from pi-crew

| Aspect | oh-my-pi | pi-crew |
|--------|----------|---------|
| Execution model | In-process (AgentSession) | Child process (pi CLI) |
| Communication | IRC tool + EventBus | File-based (manifest, artifacts) |
| Progress | Real-time EventBus (150ms coalesce) | Post-hoc file reading |
| UI | Full overlay with transcript | Powerbar segments |
| Isolation | worktree/fuse-overlay/patch | worktree (planned) |
| Tool control | Agent frontmatter `tools[]` | Agent frontmatter (new) |
| Output | yield tool (enforced) | exit code + stdout |
| Recursion | maxRecursionDepth + spawns[] | N/A |
| Streaming | AgentEvent subscription | JSON stdout parsing |
| Steering | steer()/followUp() queues | cancel/respond commands |
| Agent registry | Process-global singleton | Per-run manifest |

## 6. Applicable Patterns for pi-crew

### Priority 1 (High Impact — Giảm flicker UI)
1. **Progress coalescing** → 150ms debounce cho task progress events (tránh render quá nhiều)
2. **Incremental transcript reading** → chỉ đọc bytes mới từ file JSONL, không đọc lại toàn bộ
3. **In-process event bus** → thay thế post-hoc file reading bằng real-time events (nếu chuyển sang in-process)

### Priority 2 (Medium Impact — Tăng khả năng coordination)
4. **Yield tool enforcement** → structured output submission thay vì parse stdout
5. **IRC-like messaging** → inter-subagent coordination (anti-deadlock side-channel)
6. **Ephemeral side-channel** → respondAsBackground() không cần recipient idle

### Priority 3 (Polish — UX tốt hơn)
7. **Entry-based observer** → expand/collapse per tool call trong transcript viewer
8. **Breadcrumb navigation** → nested subagent exploration (subagent spawn subagent)
9. **Auto-scroll with manual override** → stay at bottom unless user scrolled up
10. **Semaphore-based concurrency** → Semaphore class với acquire/release thay vì Promise.all limitation
11. **Context file sharing** → parent ghi context.md, child đọc được ngay
12. **MCP proxy tools** → subagent dùng lại parent's MCP connections không cần reconnect

## 7. Nguồn dữ liệu

Báo cáo này được tổng hợp từ:
- **Đọc trực tiếp**: executor.ts (1291 lines), types.ts (277 lines), agent-dashboard.ts (1120 lines), session-observer-overlay.ts (824 lines), agent-session.ts (partial), irc.ts, agent-registry.ts, session-observer-registry.ts, task/index.ts (1274 lines)
- **Research team**: 6 parallel agents (4 explorer shards + 1 analyst synthesis + 1 writer)
  - 01_discover: Tổng quan kiến trúc
  - 02_explore-shard-1: Steering & TUI pipeline
  - 03_explore-shard-2: Lifecycle + Communication chi tiết
  - 04_explore-shard-3: pi-subagents + isolation
  - 05_synthesize: Tổng hợp phân tích
  - 06_write: Báo cáo cuối cùng
- **Total tokens**: input=446K, output=41K, cacheRead=6.4M
