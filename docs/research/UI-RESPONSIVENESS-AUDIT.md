# UI Responsiveness Audit — Agent Spawn Visibility

> Date: 2026-05-08
> Issue: Khi user nháy 1 click "team run" trên UI, không thấy rõ agent đang chạy thật hay không.

## 1. Vấn đề

User gọi `team action='run'` (foreground) hoặc `team action='parallel'` → team runner spawn agents → nhưng widget/dashboard không cập nhật ngay lập tức. User phải đợi 1-2 giây hoặc nhấn refresh mới thấy agents.

**Hệ quả**: User không biết agent đã spawn thành công hay thất bại → nháy thêm lần nữa → duplicate runs.

## 2. Root Cause Analysis

### 2.1 Event Flow (foreground run)

```
handleRun()                           [extension thread]
  → executeTeamRun()                  [extension thread]
    → runTeamTask()                   [extension thread]
      → registerStreamBridge()        [line 75, event bridge ready]
      → upsertCrewAgent()             [line 99, writes agents.json]
      → appendEvent("task.started")   [line 100, writes events.jsonl]
      → runChildPi()                  [line ~168, spawns child process]
        → child.onJsonEvent()         [callback from child stdout]
          → bridgeEventFromJsonEvent()
            → runEventBus.emit()      [emits worker_status event]
              → snapshotCache.invalidate()
              → CrewWidgetComponent.invalidate()
              → RenderScheduler.schedule()
```

### 2.2 Timing Gaps

| Step | Time | Widget shows |
|------|------|-------------|
| handleRun() starts | 0ms | Old state (no run) |
| upsertCrewAgent() writes agents.json | ~50ms | Still old state (cache TTL) |
| task.started event written | ~60ms | Still old state |
| Child process spawned | ~200ms | Still old state |
| Child stdout first JSON event | ~2-5s | **First update!** |
| Snapshot cache refresh | +500ms TTL | Updated |

**Gap**: 2-5 giây từ lúc user nhấn đến khi UI hiển thị "1 running".

### 2.3 Cụ thể

1. **Snapshot cache TTL = 500ms**: Sau khi `agents.json` được ghi, cache chỉ refresh sau khi TTL expire. Nhưng ngay cả khi TTL pass, `refreshIfStale()` check file stamps → detect change → rebuild. OK, nhưng phải đợi next `renderTick()`.

2. **Preload loop interval = 1000ms** (`DEFAULT_UI.refreshMs`): Background preload chạy mỗi 1 giây → đọc agents.json + events → update snapshot. Nhưng trong giây đầu tiên, agent chưa visible.

3. **Event bridge chỉ hoạt động khi child process output**: `bridgeEventFromJsonEvent()` emit qua `runEventBus` chỉ khi child process gửi JSON events qua stdout. Child process phải start → load Pi → initialize → mới output event đầu tiên. Lost time: 2-5s.

4. **Không có "immediate emit" khi task started**: `appendEvent("task.started")` ghi vào file nhưng không emit qua `runEventBus`. Event bridge chỉ active khi child output events.

5. **Async run**: Background run spawn process riêng → parent process không nhận events → UI chỉ update qua preload loop (1s polling).

## 3. Fixes

### Fix 1: Emit `runEventBus` event ngay khi task started (HIGH IMPACT)

**File**: `src/runtime/task-runner.ts`

Sau `upsertCrewAgent()` + `appendEvent("task.started")`, emit ngay qua `runEventBus`:

```typescript
// Line ~100, after appendEvent("task.started")
streamBridge?.handler({
    runId: manifest.runId,
    taskId: task.id,
    eventType: "task.started",
    timestamp: Date.now(),
});
```

**Impact**: UI nhận event ngay → invalidate snapshot cache → widget hiển thị "1 running" trong ~100ms thay vì 2-5s.

### Fix 2: Snapshot cache invalidate on `upsertCrewAgent` (MEDIUM IMPACT)

**File**: `src/runtime/crew-agent-records.ts`

After `saveCrewAgents()`, emit invalidate event:

```typescript
import { runEventBus } from "../ui/run-event-bus.ts";

export function upsertCrewAgent(manifest, record) {
    // ... existing code ...
    saveCrewAgents(manifest, merged);
    writeCrewAgentStatus(manifest, record);
    // NEW: Immediate UI notification
    runEventBus.emit({
        type: "worker_status",
        runId: manifest.runId,
        taskId: record.taskId,
        data: { status: record.status, role: record.role },
    });
}
```

**Impact**: Mỗi lần agent state thay đổi → UI invalidate ngay. Nhưng tốn thêm import + emit overhead.

### Fix 3: Foreground run — emit event after manifest saved (MEDIUM IMPACT)

**File**: `src/extension/team-tool/run.ts`

Sau khi `saveRunManifest()` với status "running", emit:

```typescript
import { runEventBus } from "../../ui/run-event-bus.ts";

// After saveRunManifest(manifest with status "running")
runEventBus.emit({
    type: "run_state",
    runId: manifest.runId,
    data: { status: "running" },
});
```

**Impact**: Dashboard biết run đã bắt đầu ngay, không phải đợi child process output.

### Fix 4: Widget spinner animation cho "just spawned" agents (LOW IMPACT)

**File**: `src/ui/crew-widget.ts`

Trong `agentActivity()`, nếu agent status "running" nhưng chưa có `progress.currentTool` và chưa có `startedAt` gần đây (< 5s):

```typescript
if (agent.status === "running") {
    const age = agent.startedAt ? Date.now() - new Date(agent.startedAt).getTime() : Infinity;
    if (age < 5000 && !agent.progress?.currentTool) return "spawning…";
    return agent.progress?.currentTool ? "…" : "thinking…";
}
```

**Impact**: User thấy "spawning…" thay vì "thinking…" → biết agent đang được khởi tạo.

### Fix 5: RenderScheduler immediate schedule on run start (HIGH IMPACT)

**File**: `src/extension/register.ts`

Khi `handleRun()` finish (run started), gọi `renderScheduler.schedule()` ngay thay vì đợi preload loop:

```typescript
// In handleRun(), after run started
renderScheduler?.schedule();
```

**Impact**: UI refresh ngay sau khi run started, không đợi preload loop.

## 4. Priority Matrix

| Fix | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Fix 1: Emit on task.started | HIGH | LOW | **P0** |
| Fix 2: Emit on upsertCrewAgent | MEDIUM | LOW | **P1** |
| Fix 3: Emit on manifest saved | MEDIUM | LOW | **P1** |
| Fix 4: "spawning…" indicator | LOW | LOW | **P2** |
| Fix 5: Immediate schedule | HIGH | LOW | **P0** |

## 5. Async Run Specific

Background runs (`async: true`) không thể emit events qua `runEventBus` vì chạy trong process riêng. Options:

1. **Watch manifest file changes**: Dùng `fs.watch()` trên `manifest.json` → invalidate cache khi status change
2. **Child → Parent IPC**: Background process ghi events vào JSONL → parent poll/read
3. **Acceptable latency**: Với preload loop 1s, async run visible trong ~1-2s — acceptable cho background tasks

## 6. Recommended Implementation Order

1. **Fix 1 + Fix 5** (P0): Emit event + immediate render on foreground run start
2. **Fix 4** (P2): "spawning…" indicator cho better UX
3. **Fix 2** (P1): Broader event emission on agent state changes
4. **Fix 3** (P1): Dashboard-level run start notification
