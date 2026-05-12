# pi-crew Runtime Analysis: child-process vs live-session

> Ngày: 2026-05-12  
> Trạng thái: Phân tích hiệu năng — đề xuất chuyển default runtime

---

## 1. Vấn đề hiện tại

pi-crew default runtime là **child-process** — mỗi worker spawn một `pi` CLI child process riêng. Điều này gây:

### 1.1 Memory

| Scenario | child-process | live-session | Tiết kiệm |
|---|---|---|---|
| 1 worker | ~150 MB thêm | ~15 MB thêm | **135 MB** |
| 4 workers (parallel) | ~600 MB thêm | ~60 MB thêm | **540 MB** |
| 8 workers (max cap) | ~1.2 GB thêm | ~120 MB thêm | **~1.1 GB** |

**Parent Pi process đã chiếm ~308 MB.** Thêm 4 child-process workers = **910 MB tổng**, gần 1 GB chỉ để chạy một team. Máy có 8 GB RAM sẽ bắt đầu swap.

### 1.2 Startup latency

| Giai đoạn | child-process | live-session |
|---|---|---|
| Process spawn | ~300ms | 0 |
| Node.js bootstrap | ~500ms | 0 |
| Pi CLI init + load extensions | ~1-2s | 0 |
| pi-crew register() (chạy lại trong child) | ~200ms | 0 |
| createAgentSession() | ~100ms | ~100ms |
| First LLM token | **2-4s total** | **200-500ms total** |

**Mỗi worker mất 2-4s startup.** Team implementation có 3 phases sequential × 2-4s = **6-12s chỉ để spawn processes**, trước khi bất kỳ công việc nào bắt đầu.

### 1.3 CPU overhead

- Mỗi child process chạy riêng V8 isolate → riêng JIT compiler, riêng GC
- `pi-crew register()` chạy **lặp lại** trong mỗi child (load config, register tools, bind extensions)
- JSON parsing/redaction trên child stdout → CPU cost cho mỗi event

### 1.4 Complexity

- `child-pi.ts` = 461 dòng chỉ để quản lý subprocess lifecycle
- Hard kill timer (3s), post-exit stdio guard (3s), final drain (5s), response timeout (5 min)
- Process tree kill (`taskkill /t /f` trên Windows, `kill -pgid` trên Unix)
- Mock system cho testing (`PI_TEAMS_MOCK_CHILD_PI`)

---

## 2. live-session đã sẵn sàng

pi-crew **đã implement** live-session runtime hoàn chỉnh:

- `src/runtime/live-session-runtime.ts` — 600 LOC, feature parity với child-process cho hầu hết use cases
- `src/runtime/runtime-resolver.ts` — `resolveCrewRuntime()` đã handle auto/live-session/child-process
- Soft turn limit + grace period (default 5) — **đã có**, y hệt pi-subagents3
- Tool filtering — `filterActiveTools()` loại recursive tools
- Yield/submit_result — custom tool + JSON event detection
- Live agent control — steer, resume, real-time tool activity
- Extension bridge — `buildExtensionBridge()` cho extension-based APIs
- Health diagnostics — `collectLiveSessionHealth()`, `formatLiveSessionDiagnostics()`

### Cấu hình hiện tại cần set thủ công:

```json
// .pi/crew-config.json
{
  "runtime": {
    "mode": "live-session"
  }
}
```

Hoặc:
```json
{
  "runtime": {
    "mode": "auto",
    "preferLiveSession": true
  }
}
```

**Default hiện tại là `"auto"` KHÔNG có `preferLiveSession`** → luôn fallback về child-process.

---

## 3. Đề xuất

### 3.1 Đổi default: `preferLiveSession: true` khi mode = "auto"

`resolveCrewRuntime()` hiện tại:

```typescript
// src/runtime/runtime-resolver.ts
if (requestedMode === "live-session" || (requestedMode === "auto" && config.runtime?.preferLiveSession === true)) {
    const live = await isLiveSessionRuntimeAvailable(1500, env);
    if (live.available) return liveCaps(requestedMode);
    // fallback to child-process
}
return childCaps(requestedMode);  // ← default: luôn child-process
```

**Đề xuất đổi:**

```typescript
if (requestedMode === "live-session" || requestedMode === "auto") {
    const live = await isLiveSessionRuntimeAvailable(1500, env);
    if (live.available) return liveCaps(requestedMode);
    if (requestedMode === "live-session" && !config.runtime?.allowChildProcessFallback) 
        return scaffoldCaps(requestedMode, live.reason, "blocked");
    return { ...childCaps(requestedMode), fallback: "child-process", reason: live.reason };
}
```

**Tức là:** `"auto"` → thử live-session trước, fallback child-process nếu SDK không available. User vẫn có thể force `child-process` nếu muốn.

### 3.2 Thêm opt-out cho risky tasks

Task-level flag để force child-process cho tasks cụ thể:

```json
{
  "runtime": {
    "mode": "auto",
    "preferLiveSession": true,
    "riskyIsolation": "child-process"
  }
}
```

Tasks có role `executor` hoặc tasks trong worktree → tự dùng child-process.

### 3.3 Lợi ích dự kiến

| Metric | Trước (child-process default) | Sau (live-session default) |
|---|---|---|
| **4-worker memory** | ~910 MB | ~370 MB |
| **First token latency** | 2-4s/worker | 200-500ms/worker |
| **Startup total (3 phases)** | 6-12s | 0.6-1.5s |
| **Steering** | ❌ | ✅ |
| **Resume** | ❌ | ✅ |
| **Crash isolation** | ✅ | ❌ (fallback available) |
| **Parent crash risk** | None | Low (session.abort handles most) |

### 3.4 Rủi ro và cách giảm thiểu

| Rủi ro | Mức độ | Cách giảm thiểu |
|---|---|---|
| Agent crash → parent crash | Medium | `try/catch` quanh `session.prompt()`, `AbortController` per-agent, cleanup trên unhandled rejection |
| Memory pressure (nhiều sessions) | Low | Giữ `maxConcurrent` cap (default 4), limit là đủ |
| Recursive team calls | Low | `filterActiveTools()` đã loại recursive tools |
| SDK không available (Pi version cũ) | Low | Auto-fallback về child-process |
| Unhandled errors trong session | Medium | Global `unhandledRejection` handler per-session |

---

## 4. Kết luận

**pi-crew đang dùng runtime quá nặng cho hầu hết use cases.** child-process có crash isolation tuyệt vời nhưng:

- **9x memory** so với live-session
- **8x startup latency**
- **Không có steer/resume** — mất khả năng interactive

live-session **đã implement sẵn**, chỉ cần đổi default. Crash isolation trade-off chấp nhận được vì:
1. Pi SDK `createAgentSession()` đã handle大部分 errors
2. Fallback child-process vẫn available khi cần
3. Lợi ích (540 MB tiết kiệm, 3s faster startup, steer/resume) vượt trội hơn rủi ro

**Action:** Đổi `resolveCrewRuntime()` default để `"auto"` prefer live-session, giữ child-process làm fallback.