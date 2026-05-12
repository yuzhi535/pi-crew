# Phân tích: Chuyển pi-crew hoàn toàn sang in-process execution

> Ngày: 2026-05-12  
> Câu hỏi: Nếu chuyển hẳn sang in-process giống pi-subagents3 thì sao?

---

## 1. Hiện trạng

pi-crew có **3 runtime modes**, child-process là default:

```
scaffold      → không chạy workers (dry-run)
child-process → spawn `pi` CLI subprocess per worker (DEFAULT)
live-session  → createAgentSession() in-process per worker
```

### Code liên quan child-process

| File | LOC | Vai trò |
|---|---|---|
| `child-pi.ts` | 461 | Subprocess lifecycle, stdout parsing, kill process tree |
| `pi-args.ts` | 165 | Build CLI args cho child `pi` process |
| `pi-spawn.ts` | 167 | Detect `pi` binary path (local/global) |
| `post-exit-stdio-guard.ts` | 86 | Drain child stdout sau exit, hard kill timer |
| `async-runner.ts` | 153 | Spawn background team runs ( detached process) |
| **Tổng** | **1.032** | **Code chỉ dùng cho child-process** |

### Code liên quan live-session (đã có sẵn)

| File | LOC | Vai trò |
|---|---|---|
| `live-session-runtime.ts` | 600 | In-process execution, soft turn limit, yield, custom tools |
| `runtime-resolver.ts` | 92 | Auto-detect available runtime |
| `task-runner/live-executor.ts` | 95 | Adapter: live-session → task-runner interface |

### Files sử dụng child-process path

- `task-runner.ts` — 8 references, ~120 dòng logic riêng child-process (heartbeat, progress, model retry)
- `register.ts` — `terminateActiveChildPiProcesses()` cleanup
- `doctor.ts` — diagnose child-process issues
- `async-runner.ts` — spawn background team runs

### Tests liên quan

- ~37 test files reference child-process / mock child
- ~3 test files reference live-session mock
- Tất cả integration tests dùng `PI_TEAMS_MOCK_CHILD_PI` — **cần rewrite** nếu bỏ child-process

---

## 2. Nếu chuyển hẳn sang in-process

### 2.1 Những gì ĐƯỢC

#### Lợi tức tức thì

| Metric | child-process | in-process | Cải thiện |
|---|---|---|---|
| Memory / worker | ~150 MB | ~15 MB | **10× nhẹ hơn** |
| 4 workers peak | ~600 MB thêm | ~60 MB thêm | **540 MB tiết kiệm** |
| Startup / worker | 2-4s | 200-500ms | **8× nhanh hơn** |
| Team startup (3 phases) | 6-12s overhead | ~1s overhead | **6-12× nhanh hơn** |
| Steering | ❌ | ✅ | **Tính năng mới** |
| Resume | ❌ | ✅ | **Tính năng mới** |
| Context inheritance | ❌ | ✅ (parentContext) | **Tính năng mới** |
| Live tool activity | ❌ | ✅ | **Tính năng mới** |
| Yield/submit_result | ✅ (JSON event) | ✅ (custom tool) | Parity |
| Worktree isolation | ✅ | ✅ | Parity |

#### Lợi tức kiến trúc

- **Xóa ~1.000 LOC** subprocess management code
- Đơn giản hóa `task-runner.ts` (bỏ 120 dòng child-process logic)
- Bỏ `post-exit-stdio-guard.ts`, `pi-spawn.ts`, `pi-args.ts` subprocess overhead
- Bỏ `responseTimeoutMs`, `hardKillMs`, `postExitStdioGuardMs` — không cần kill process tree
- **Zero npm dependencies cho execution** (hiện cần `jiti` cho async-runner TypeScript loading)

### 2.2 Những gì MẤT

#### ❌ Process isolation — biggest loss

```
child-process:  worker crash → worker dies → parent continues
in-process:     worker crash → có thể crash parent → toàn bộ team mất
```

Pi SDK `createAgentSession()` đã handle phần lớn errors, nhưng:
- **Unhandled promise rejection** trong session
- **Infinite loop** trong custom tool
- **OOM** — một session ăn hết memory ảnh hưởng tất cả
- **Node.js segfault** — rare nhưng khi xảy ra = chết hết

#### ❌ Async background team runs

`async-runner.ts` spawn một **detached process** chạy team khi user close terminal. In-process không thể — process chết khi terminal close.

**Giải pháp:** Giữ `async-runner.ts` riêng cho background runs — nó spawn cả team runner, không phải individual workers.

#### ❌ Depth guard đơn giản

`checkCrewDepth()` đếm `PI_CREW_PARENT_PID` env var. In-process không có process boundary → đếm depth khó hơn. Cần dùng global counter hoặc thread-local.

#### ❌ 37+ test files cần update

Tất cả integration tests dùng `PI_TEAMS_MOCK_CHILD_PI`. Cần chuyển sang `PI_CREW_MOCK_LIVE_SESSION` hoặc viết mock mới.

#### ❌ `_CrewRuntimeKind` type union

`"scaffold" | "child-process" | "live-session"` → nếu bỏ child-process thì chỉ còn `"scaffold" | "in-process"`. Breaking change cho config.

### 2.3 Rủi ro cụ thể

| Rủi ro | Mức độ | Chi tiết |
|---|---|---|
| Parent crash | **Medium** | Unhandled error in agent session → parent dies. Pi SDK wraps大部分 nhưng không phải 100%. |
| Memory pressure | **Medium** | 4 in-process sessions + context windows có thể chiếm >500MB trong cùng heap. V8 GC pause. |
| Extension conflicts | **Low** | In-process extensions có thể conflict (global state, tool registry). Đã có filter nhưng edge cases. |
| Recursive team calls | **Low** | `team` tool trong agent session → infinite recursion. Đã filter nhưng cần guarantee. |
| Background runs | **Solved** | Giữ `async-runner.ts` riêng, chỉ spawn 1 detached process cho full team. |
| Breaking config | **Low** | User đang set `mode: "child-process"` → cần migration path. |

---

## 3. Hai hướng đi

### Hướng A: Bỏ hoàn toàn child-process (giống pi-subagents3)

```
                 ┌─────────────────────────┐
                 │   task-runner.ts         │
                 │   runtime = "in-process" │
                 ├─────────────────────────┤
                 │ live-session-runtime.ts  │
                 │ createAgentSession()     │
                 │ session.prompt()         │
                 │ session.steer()          │
                 ├─────────────────────────┤
                 │    Pi SDK (shared)       │
                 └─────────────────────────┘
```

**Xóa:** `child-pi.ts`, `pi-args.ts`, `pi-spawn.ts`, `post-exit-stdio-guard.ts` (~879 LOC)  
**Giữ:** `async-runner.ts` (cho background team runs — spawn 1 process cho cả team, không phải per-worker)  
**Đổi:** `task-runner.ts` → bỏ child-process branch, chỉ dùng live-session  
**Đổi:** Tất cả 37+ test files  

**Pros:** Clean architecture, đơn giản nhất, maintenance thấp nhất  
**Cons:** Mất crash isolation cho per-worker, nhiều test cần rewrite

### Hướng B: Live-session default + child-process opt-in (khuyến nghị)

```
                 ┌─────────────────────────────────┐
                 │        task-runner.ts            │
                 │   default: live-session          │
                 │   opt-in: child-process          │
                 │   background: async-runner       │
                 ├──────────┬───────────────────────┤
                 │ in-proc  │  child-process         │
                 │ (fast)   │  (isolated, fallback)  │
                 └──────────┴───────────────────────┘
```

**Đổi:** `runtime-resolver.ts` → `"auto"` prefer live-session  
**Giữ:** Tất cả child-process code (fallback)  
**Giữ:** Tất cả tests  
**Thêm:** Config `"riskyIsolation": true"` cho executor role auto-use child-process  

**Pros:** Best of both worlds, zero breaking change  
**Cons:** Vẫn maintain 2 code paths

---

## 4. Khuyến nghị: Hướng B

**Không nên bỏ child-process hoàn toàn** — quá rủi ro cho production. Thay vào đó:

### Bước 1: Đổi default runtime (nhanh, ít rủi ro)

```typescript
// runtime-resolver.ts
// Trước: "auto" → luôn child-process
// Sau:   "auto" → thử live-session, fallback child-process

export async function resolveCrewRuntime(config, env) {
    const requestedMode = config.runtime?.mode ?? "auto";
    if (requestedMode === "auto") {
        const live = await isLiveSessionRuntimeAvailable(1500, env);
        if (live.available) return liveCaps(requestedMode);
        return { ...childCaps(requestedMode), fallback: "child-process", reason: live.reason };
    }
    // Explicit modes still work
    if (requestedMode === "child-process") return childCaps(requestedMode);
    if (requestedMode === "live-session") { /* ... */ }
    // ...
}
```

### Bước 2: Thêm per-role isolation policy

```json
// crew-config.json
{
  "runtime": {
    "mode": "auto",
    "isolationPolicy": {
      "executor": "child-process",   // risky code changes → isolated
      "test-engineer": "child-process", // test runs → isolated
      "default": "in-process"         // everything else → fast
    }
  }
}
```

### Bước 3: Observability cho in-process errors

```typescript
// Wrap session.prompt() với global error handler
process.on('unhandledRejection', (err) => {
    logInternalError('live-session.unhandled', err);
    // Don't crash — attempt recovery
});
```

### Lợi tức dự kiến Hướng B

| | Hiện tại | Sau Bước 1 | Sau Bước 2 |
|---|---|---|---|
| **Default runtime** | child-process | live-session (auto) | live-session + per-role |
| **Memory (4 workers)** | ~910 MB | ~370 MB | ~450 MB (mix) |
| **Startup** | 2-4s/worker | 200-500ms/worker | Mix |
| **Crash isolation** | ✅ all | ✅ fallback | ✅ risky roles |
| **Steering** | ❌ | ✅ | ✅ |
| **Breaking changes** | — | None | None |
| **Code xóa** | — | 0 | 0 (giữ fallback) |
| **Tests cần đổi** | — | 0 | 0 |

---

## 5. Kết luận

**Không nên chuyển hẳn 100% in-process.** Lý do:

1. **Crash isolation quá quan trọng** cho executor/test-engineer roles — những agent này chạy code, write files, có thể infinite loop
2. **Background runs cần detached process** — không thể in-process
3. **37+ test files cần rewrite** — chi phí migration cao
4. **Breaking change** cho users đang dùng `mode: "child-process"`

**Thay vào đó: Đổi default sang live-session + giữ child-process làm fallback/opt-in.** Đây chính là thiết kế sẵn của `resolveCrewRuntime()` — chỉ cần flip default trong `"auto"` mode. Zero code xóa, zero breaking change, users tự chọn khi cần isolation.
