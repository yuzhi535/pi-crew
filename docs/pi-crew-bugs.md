# pi-crew v0.2.20 — Bug Report

**Ngày:** 2026-05-19  
**Session:** Comprehensive integration test + root cause analysis  
**Environment:** linux/x64, Node v22.22.0, Pi CLI v0.75.3, pi-crew v0.2.20

---

## Bug #1: Background workers "heartbeat dead" — thực chất là MiniMax 429 Rate Limit

| Field | Value |
|---|---|
| **Severity** | 🔴 HIGH |
| **Status** | ✅ Fixed — 429 now retries with fallback models instead of blocking 300s |
| **Affected** | Tất cả background/async workers |
| **Symptom** | Workers timeout sau 300s với "heartbeat dead", zero output |

### Mô tả

Khi chạy `team action='run'` với `async=true` hoặc `Agent(run_in_background=true)`, workers spawn thành công (PID tồn tại) nhưng **timeout sau 300s** với generic error:
```
worker.response_timeout: No output for 300000ms
crew.task.heartbeat_dead: Task 01_assess heartbeat dead.
```

### Root cause

**Đã fix.** Trước đây 429 rate limit không được retry vì:
1. `RETRYABLE_MODEL_FAILURE_PATTERNS` có `/\b429\b/` nhưng MiniMax trả về `rate_limit_error: usage limit exceeded` (không có số 429 rõ ràng)
2. 429 được fast-fail trong `child-pi.ts onJsonEvent` thay vì để task-runner xử lý retry với fallback

### Fix applied

1. **model-fallback.ts**: Thêm `/rate_limit_error/i` vào `RETRYABLE_MODEL_FAILURE_PATTERNS` để nhận diện đúng MiniMax rate limit error
2. **model-fallback.ts**: Sửa `/\b429\b/` → `/rate.?limit/i` để match nhiều format hơn
3. **child-pi.ts**: Bỏ fast-fail 429 — để task-runner xử lý retry với model fallback chain

### Model fallback chain

Khi model chính bị 429:
1. Fallback sang `fallbackModels` (nếu có cấu hình)
2. Fallback sang available models khác trong hệ thống
3. Nếu không có fallback và retry hết → fail với đúng error message

**Cấu hình khuyến nghị:** Thêm `fallbackModels` vào agent config để có nhiều lựa chọn khi model chính bị rate limit.

---

## Bug #2: child-pi.ts không phát hiện 429 rate limit error — báo sai "heartbeat dead"

| Field | Value |
|---|---|
| **Severity** | 🔴 HIGH |
| **Status** | New — phát hiện trong quá trình debug Bug #1 |
| **Affected** | Tất cả child Pi workers |
| **Symptom** | Worker báo generic "No output for 300000ms" thay vì "Provider rate limit: 429" |

### Mô tả

Pi CLI output JSON events cho 429 errors rất rõ ràng:
```json
{"type":"turn_end","message":{"stopReason":"error","errorMessage":"429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"...}}"}}
```

Nhưng `child-pi.ts` **không parse error events** — nó chỉ quan tâm đến:
- `isFinalAssistantEvent()` — để trigger final drain
- `turn_end` — để đếm turns cho turn limiting

Kết quả: child-pi thấy output (JSON events), **restart heartbeat timer**, nhưng **không nhận ra đây là error**. Pi block sau 3 retries → heartbeat timeout 300s → generic error message.

### Code location

`/home/bom/source/my_pi/pi-crew/src/runtime/child-pi.ts`, line ~394:
```typescript
onJsonEvent: (event) => {
    restartNoResponseTimer();
    // Turn-count-based steering: chỉ đếm turns, KHÔNG check errors
    if (event && typeof event === "object" && !Array.isArray(event)) {
        const obj = event as Record<string, unknown>;
        if (obj.type === "turn_end") {
            turnCount += 1;
            // ... turn limit logic only ...
        }
    }
    // MISSING: detect provider errors (429, auth, etc.)
}
```

### Fix

Thêm provider error detection trong `onJsonEvent`:
```typescript
let providerError: string | undefined;

// In onJsonEvent:
if (obj.type === "turn_end" && obj.message?.stopReason === "error") {
    const errMsg = obj.message?.errorMessage || "";
    if (errMsg && !providerError) providerError = errMsg;
    // Fast-fail on rate limit — don't wait 300s
    if (/429|rate.?limit/i.test(errMsg)) {
        settle({ exitCode: 1, stdout, stderr: `Provider rate limit: ${errMsg.slice(0, 200)}` });
    }
}
```

### Impact

Fix này sẽ chuyển error message từ:
```
❌ "Child Pi produced no new output for 300000ms; process was terminated as unresponsive."
```
Thành:
```
✅ "Provider rate limit: 429 rate_limit_error: usage limit exceeded, resets at 2026-05-19T05:00:00Z"
```

Và **fail fast** thay vì đợi 300s.

---

## Bug #3: background.log vô dụng — không capture worker output

| Field | Value |
|---|---|
| **Severity** | 🟠 MEDIUM |
| **Status** | New — phát hiện trong quá trình debug Bug #1 |
| **Affected** | Debugging experience cho tất cả background runs |
| **Symptom** | background.log chỉ chứa 1 dòng: `[pi-crew] background loader=jiti` |

### Mô tả

Khi background worker fail, log file tại `.crew/state/runs/<id>/background.log` chỉ chứa:
```
[pi-crew] background loader=jiti
```

Không có:
- Worker stdout/stderr
- Error messages
- Provider responses
- Exit codes

### Nguyên nhân

`async-runner.ts` line 130-145:
```typescript
const logFd = fs.openSync(logPath, "a");
// ...
const child = spawn(process.execPath, command.args, buildBackgroundSpawnOptions(manifest, logFd));
```

`buildBackgroundSpawnOptions` line 123-127:
```typescript
return {
    cwd: manifest.cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],  // stdout+stderr → background.log
    // ...
};
```

**stdout/stderr của background-runner** được ghi vào background.log. Nhưng **child Pi workers** (spawn bởi background-runner qua child-pi.ts) **output vào child-pi's pipe**, KHÔNG vào background.log.

Flow:
```
background-runner.ts (stdout→logFd, stderr→logFd)
  → loader=jiti → ghi vào log ✅
  → executeTeamRun()
    → child-pi.ts spawn child Pi (stdout→pipe, stderr→pipe)
      → Pi output → child-pi.ts captures →KHÔNG GHI VÀO background.log ❌
```

### Fix

1. **Option A:** Trong `child-pi.ts` hoặc `team-runner.ts`, ghi worker output events vào background.log
2. **Option B:** Thêm event log entries cho provider errors (đã có event log, nhưng không đủ chi tiết)
3. **Option C:** Background-runner tee output vào log file

### Key file

```
pi-crew/src/runtime/async-runner.ts  — buildBackgroundSpawnOptions(), spawnBackgroundTeamRun()
```

---

## Bug #4: worker-startup.ts thiếu "rate_limited" classification

| Field | Value |
|---|---|
| **Severity** | 🟡 LOW |
| **Status** | New — phát hiện trong quá trình debug Bug #1 |
| **Affected** | Error classification và reporting |
| **Symptom** | 429 errors classified là "unknown" thay vì "rate_limited" |

### Mô tả

`worker-startup.ts` có `StartupFailureClassification` type:
```typescript
export type StartupFailureClassification = 
    | "trust_required" 
    | "prompt_misdelivery" 
    | "prompt_acceptance_timeout" 
    | "transport_dead" 
    | "worker_crashed" 
    | "unknown";
```

Thiếu `"rate_limited"` và `"provider_error"`. Kết quả: 429 errors bị classify là `"unknown"`.

### Fix

Thêm vào type và `classifyStartupFailure` function:
```typescript
export type StartupFailureClassification = 
    | "trust_required" 
    | "prompt_misdelivery" 
    | "prompt_acceptance_timeout" 
    | "transport_dead" 
    | "worker_crashed" 
    | "rate_limited"      // NEW
    | "provider_error"    // NEW
    | "unknown";

// In classifyStartupFailure:
if (evidence.stderrPreview && /429|rate.?limit/i.test(evidence.stderrPreview)) return "rate_limited";
if (evidence.stderrPreview && /5\d{2}|server.?error|internal.?error/i.test(evidence.stderrPreview)) return "provider_error";
```

### Key file

```
pi-crew/src/runtime/worker-startup.ts  — StartupFailureClassification, classifyStartupFailure()
```

---

## Bug #5: Stale heartbeat notifications sau prune

| Field | Value |
|---|---|
| **Severity** | 🟡 LOW (cosmetic) |
| **Status** | Confirmed |
| **Affected** | User experience |
| **Symptom** | "Task heartbeat dead" notifications cho runs đã bị xóa |

### Mô tả

Sau khi chạy `team prune --keep=0 --confirm=true`, background watcher vẫn emit notifications cho runs đã prune:

```
→ team prune: Removed 9 runs
→ Notification: "agent_mpc423rq_1 heartbeat dead" (run not found)
→ Notification: "agent_mpc423rv_2 heartbeat dead" (run not found)  
→ Notification: "agent_mpc423rw_3 heartbeat dead" (run not found)
→ Notification: "agent_mpc423rw_4 heartbeat dead" (run not found)
... (6+ stale notifications)
```

Mỗi notification trigger `get_subagent_result` → trả về "not found".

### Nguyên nhân

Background watcher duy trì worker health check queue. Khi runs bị prune:
1. Watcher không deregister ngay
2. Notifications đã trong queue vẫn emit
3. Các notifications đến lần lượt, cách nhau vài giây

### Impact

- Confusing cho user: thấy "heartbeat dead" cho runs không còn tồn tại
- Wasted context: mỗi notification trigger 1 tool call để verify

### Fix

Background watcher nên check run existence trước khi emit:
```typescript
// Before emitting heartbeat_dead:
if (!runExists(runId)) {
    deregisterWorker(workerId);  // Silent cleanup
    return;
}
```

### Key files

```
pi-crew/src/runtime/worker-heartbeat.ts  — isWorkerHeartbeatStale()
pi-crew/src/runtime/background-runner.ts — heartbeat monitoring loop
```

---

## Bug #6: Live-session run bị cancel giữa chừng

| Field | Value |
|---|---|
| **Severity** | 🟠 MEDIUM |
| **Status** | Observed once, needs investigation |
| **Affected** | Foreground team runs |
| **Symptom** | Run cancelled sau khi explore phase hoàn thành, trước execute phase |

### Mô tả

Fast-fix team chạy live-session:
```
04:12:20 live-session.prompt_start 01_explore
04:12:51 live-session.prompt_done 01_explore (31s, completed)
04:12:51 live_agent.terminated 01_explore (status=cancelled)
04:12:51 task.completed 01_explore
04:12:51 run.cancelled: "This operation was aborted"
```

Task `01_explore` hoàn thành thành công, nhưng run bị cancelled trước khi `02_execute` bắt đầu.

### Nguyên nhân có thể

1. **Session concurrency limit** — chỉ 1 live-session active, conflict với parallel test operations
2. **User-initiated cancellation** — accidentally triggered
3. **Workflow phase transition bug** — không trigger next phase sau explore completes

### Cần thêm investigation

- Chạy lại fast-fix team đơn lẻ (không concurrent operations)
- Check live-session-runtime.ts cho phase transition logic

---

## Summary

| # | Bug | Severity | Status | Category |
|---|---|---|---|---|
| 1 | Background workers timeout do MiniMax 429 | 🔴 HIGH | ✅ Fixed — 429 now retries with fallback models via improved RETRYABLE_MODEL_FAILURE_PATTERNS | Code |
| 2 | child-pi.ts không phát hiện 429, báo sai "heartbeat dead" | 🔴 HIGH | ✅ Fixed — removed fast-fail 429; let task-runner handle retry+fallback | Code |
| 3 | background.log vô dụng, không capture worker output | 🟠 MEDIUM | ✅ Fixed — added PI_CREW_BACKGROUND_MODE flag + event logging to background.log | Observability |
| 4 | worker-startup.ts thiếu rate_limited classification | 🟡 LOW | ✅ Fixed — added rate_limited + provider_error to StartupFailureClassification | Code |
| 5 | Stale heartbeat notifications sau prune | 🟡 LOW | ✅ Fixed — HeartbeatWatcher skips pruned runs via stateRoot existence check | UX |
| 6 | Live-session run bị cancel giữa chừng | 🟠 MEDIUM | 🔲 Cannot definitively reproduce — likely Pi session lifecycle issue | Runtime |

### Priority fix order

1. **Bug #1** — ✅ Fixed — 429 now retried with model fallback chain
2. **Bug #2** — ✅ Fixed — removed fast-fail 429
3. **Bug #3** — ✅ Fixed — worker events now logged to background.log
4. **Bug #4** — ✅ Fixed — rate_limited + provider_error classification added
5. **Bug #5** — ✅ Fixed — HeartbeatWatcher skips pruned runs
6. **Bug #6** — 🔲 Cannot reproduce — likely Pi session lifecycle (requires live environment)
