# 📋 Implementation Plan: Thu hẹp Gap với oh-my-pi

> Dựa trên `COMPARISON_OH_MY_PI_VS_PI_CREW.md`
> Mục tiêu: Giảm UI flicker, tăng real-time responsiveness, structured output, inter-worker communication

---

## Phased Approach

```
Phase 1 (2 tasks) ─── Real-time Event Bridge ──────────── HIGH impact
Phase 2 (2 tasks) ─── Structured Output & Yield ────────── MEDIUM impact
Phase 3 (2 tasks) ─── Inter-Worker Communication ───────── MEDIUM impact
Phase 4 (2 tasks) ─── Agent Config UI & Polish ─────────── LOW impact
```

---

## Phase 1: Real-time Event Bridge

> **Problem**: UI đọc từ files (manifest, tasks.json) mỗi 500-1000ms → flicker, chậm
> **Solution**: Bridge child Pi JSON events trực tiếp đến UI qua RunEventBus

### Task 1.1: Event Stream Bridge

**File mới**: `src/runtime/event-stream-bridge.ts`

**Ý tưởng**: Kết nối `onJsonEvent` callback trong `task-runner.ts` trực tiếp đến `runEventBus` (đã tồn tại), thay vì chỉ ghi file rồi poll.

```
Current flow (chậm):
  child Pi → stdout JSON → onJsonEvent → appendCrewAgentEvent (file)
                                                    ↓
  UI poll (500ms) → read files → render

New flow (nhanh):
  child Pi → stdout JSON → onJsonEvent → appendCrewAgentEvent (file)
                                      └→ runEventBus.emit() → UI callback → render
```

**Implementation**:
```typescript
// event-stream-bridge.ts
import { runEventBus, type RunEventPayload } from "../ui/run-event-bus.ts";

export interface StreamBridgeEvent {
  runId: string;
  taskId: string;
  eventType: string;
  toolName?: string;
  toolArgs?: string;
  intent?: string;
  tokens?: number;
  timestamp: number;
}

const bridge = new Map<string, (event: StreamBridgeEvent) => void>();

export function registerStreamBridge(runId: string): (event: StreamBridgeEvent) => void {
  const handler = (event: StreamBridgeEvent) => {
    runEventBus.emit({
      type: "worker_status",
      runId: event.runId,
      taskId: event.taskId,
      data: event,
    });
  };
  bridge.set(runId, handler);
  return handler;
}

export function unregisterStreamBridge(runId: string): void {
  bridge.delete(runId);
}
```

**Thay đổi trong `task-runner.ts`**:
- Import `registerStreamBridge` / `unregisterStreamBridge`
- Trong `onJsonEvent` callback: gọi thêm bridge handler
- Trong task cleanup: unregister bridge

**Thay đổi trong `run-snapshot-cache.ts`**:
- Subscribe `runEventBus.on(runId, ...)` cho active run
- On event: invalidate cache cho task đó (thay vì TTL-based refresh)
- Giảm TTL từ 500ms → 200ms cho polled data, nhưng event-driven cho real-time

**Risk**: LOW — chỉ thêm event emission, không thay đổi flow hiện tại

---

### Task 1.2: Render Coalescing & Debounce

**File mới**: `src/ui/render-coalescer.ts`

**Ý tưởng**: Gom nhiều render requests thành 1 render duy nhất trong 1 frame (16ms). Tránh render nhiều lần khi nhiều events đến cùng lúc.

```typescript
// render-coalescer.ts
export class RenderCoalescer {
  #pending = false;
  #rafId: ReturnType<typeof setTimeout> | null = null;
  #callback: () => void;
  #intervalMs: number;

  constructor(callback: () => void, intervalMs = 32) { // ~30fps
    this.#callback = callback;
    this.#intervalMs = intervalMs;
  }

  request(): void {
    if (this.#pending) return;
    this.#pending = true;
    this.#rafId = setTimeout(() => {
      this.#pending = false;
      this.#rafId = null;
      this.#callback();
    }, this.#intervalMs);
  }

  flush(): void {
    if (this.#rafId) clearTimeout(this.#rafId);
    this.#pending = false;
    this.#rafId = null;
    this.#callback();
  }

  dispose(): void {
    if (this.#rafId) clearTimeout(this.#rafId);
    this.#pending = false;
  }
}
```

**Thay đổi trong `run-dashboard.ts`**:
- Wrap `invalidate()` calls trong `RenderCoalescer`
- Khi event đến → `coalescer.request()` thay vì `invalidate()` trực tiếp
- Khi user input → `coalescer.flush()` (responsive input)

**Thay đổi trong `powerbar-publisher.ts`**:
- Wrap `safeEmit()` trong coalescer
- Giảm powerbar update frequency xuống ~200ms

**Risk**: LOW — chỉ thêm debounce layer

---

## Phase 2: Structured Output & Yield

### Task 2.1: Output Schema in Task Packets

**File sửa**: `src/runtime/task-packet.ts`

**Ý tưởng**: Thêm optional `outputSchema` field vào task packet, worker prompt hướng dẫn subagent output theo schema.

```typescript
// task-packet.ts — thêm field
export interface TaskPacket {
  // ... existing fields
  outputSchema?: {
    type: "json" | "markdown" | "text";
    schema?: unknown;     // JTD/JSON Schema for JSON output
    description?: string; // human-readable expected output
  };
}
```

**Thay đổi trong `prompt-builder.ts`**:
- Nếu `taskPacket.outputSchema` được set → thêm output format instruction vào prompt
- Pattern từ oh-my-pi: "Your result MUST match this TypeScript interface: ..."

**Risk**: LOW — additive, không ảnh hưởng existing tasks

---

### Task 2.2: Structured Result Extraction

**File mới**: `src/runtime/result-extractor.ts`

**Ý tưởng**: Parse worker output cố gắng extract structured JSON trước khi fallback sang raw text.

```typescript
// result-extractor.ts
export interface ExtractedResult {
  structured: boolean;
  data: unknown;
  rawText: string;
  error?: string;
}

export function extractStructuredResult(raw: string, schema?: unknown): ExtractedResult {
  // 1. Try JSON parse
  // 2. Try extract from ```json``` fence
  // 3. Try extract from ADAPTIVE_PLAN_JSON markers (existing)
  // 4. Fallback to raw text
}
```

**Thay đổi trong `task-runner.ts`**:
- Sau khi có `parsedOutput.finalText` → chạy qua `extractStructuredResult`
- Lưu structured result vào artifact riêng (metadata/{taskId}.result.json)

**Risk**: LOW — chỉ thêm extraction layer, không thay đổi existing flow

---

## Phase 3: Inter-Worker Communication

### Task 3.1: Mailbox Reply Support

**File sửa**: `src/state/mailbox.ts`

**Ý tưởng**: Mailbox hiện tại là fire-and-forget. Thêm `replyTo` field cho phép worker trả lời message.

```typescript
// mailbox.ts — thêm fields
export interface MailboxMessage {
  // ... existing fields
  replyTo?: string;        // ID của message gốc (nếu là reply)
  replyFrom?: string;      // Task ID gửi reply
  replyDeadline?: number;  // Ms deadline cho reply
}

export interface MailboxMessageStatus {
  // ... existing fields
  repliedAt?: string;      // Khi reply được nhận
  replyContent?: string;   // Nội dung reply
}
```

**Thay đổi trong prompt-builder.ts**:
- Nếu task có unread mailbox messages với `replyTo` → thêm instruction "Reply to this message using the respond command"

**Risk**: MEDIUM — thay đổi mailbox schema, cần migration

---

### Task 3.2: Dependency Context Enhancement

**File sửa**: `src/runtime/task-output-context.ts`

**Ý tưởng**: Hiện tại chỉ collect output text. Thêm collect structured data (JSON results, artifacts produced).

```typescript
// task-output-context.ts — thêm
export interface DependencyContext {
  taskId: string;
  role: string;
  status: string;
  resultSummary: string;       // existing text output
  structuredResults?: Map<string, unknown>;  // NEW: parsed JSON results
  artifactsProduced?: string[];               // NEW: artifact paths
  usage?: { tokens: number; durationMs: number }; // NEW: usage stats
}
```

**Risk**: LOW — additive extension

---

## Phase 4: Agent Config UI & Polish

### Task 4.1: Agent Management Dashboard

**File mới**: `src/ui/overlays/agent-management-overlay.ts`

**Ý tưởng**: UI overlay cho phép enable/disable agents, xem model resolution, edit model override — tương tự oh-my-pi's `AgentDashboard`.

**Features**:
- List agents from discovery (agents/ dir)
- Show source (project/user/package), description, model
- Toggle enable/disable → writes to config
- Edit model override → inline input
- Keyboard navigation (j/k, Tab, Enter, Esc)

**Risk**: MEDIUM — requires Pi TUI component support, may need pi-mono API

---

### Task 4.2: Transcript Entry Viewer Enhancement

**File sửa**: `src/ui/transcript-viewer.ts`

**Ý tưởng**: Thêm expand/collapse per entry (như oh-my-pi's SessionObserverOverlay).

**Features**:
- Entry-based navigation (each tool call/message = 1 entry)
- `Enter` toggle expand/collapse
- `j/k` move between entries
- Auto-scroll to bottom unless user scrolled up
- Breadcrumb for nested subagent transcripts (if available)

**Risk**: LOW — extending existing transcript viewer

---

## Dependency Graph

```
Phase 1:
  1.1 Event Stream Bridge ─────┐
  1.2 Render Coalescing ────────┤ (independent, can parallel)
                                └→ UI responsiveness improved
Phase 2:
  2.1 Output Schema ───────────┐
  2.2 Result Extractor ─────────┤ (2.1 before 2.2)
                                └→ Structured output capability
Phase 3:
  3.1 Mailbox Reply ───────────┐
  3.2 Dependency Context ──────┤ (independent, can parallel)
                                └→ Inter-worker communication
Phase 4:
  4.1 Agent Dashboard ─────────┐
  4.2 Transcript Enhancement ──┤ (independent, can parallel)
                                └→ Polish & UX
```

---

## Effort Estimates

| Task | Lines | Files | Tests | Phase |
|------|-------|-------|-------|-------|
| 1.1 Event Stream Bridge | ~80 new, ~30 modified | 3 | 5 | 1 |
| 1.2 Render Coalescing | ~60 new, ~20 modified | 3 | 4 | 1 |
| 2.1 Output Schema | ~40 modified | 2 | 3 | 2 |
| 2.2 Result Extractor | ~100 new, ~20 modified | 3 | 8 | 2 |
| 3.1 Mailbox Reply | ~80 modified | 3 | 6 | 3 |
| 3.2 Dependency Context | ~50 modified | 2 | 4 | 3 |
| 4.1 Agent Dashboard | ~300 new | 2 | 8 | 4 |
| 4.2 Transcript Enhancement | ~120 modified | 1 | 6 | 4 |
| **Total** | **~850** | **~19** | **~44** | |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Event bridge causes memory leak | Low | Medium | Unregister on task complete, WeakRef for handlers |
| Render coalescer misses last event | Low | Low | `flush()` on task complete + user input |
| Output schema breaks existing tasks | Low | Medium | Optional — only enforce when schema is set |
| Mailbox reply schema migration | Medium | Low | Additive fields only, no breaking change |
| Agent dashboard needs pi-mono API | Medium | Medium | Fallback to file-based config if API unavailable |
| Child Pi event format changes | Low | High | Defensive parsing with fallback |

---

## Testing Strategy

- **Phase 1**: Unit test bridge registration/emission, coalescer debounce timing
- **Phase 2**: Unit test result extraction with various output formats
- **Phase 3**: Unit test mailbox reply flow, integration test with real workers
- **Phase 4**: Manual UI testing + screenshot comparison
- **All phases**: `npm test` (868 tests baseline) must stay green
