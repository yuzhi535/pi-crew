# Caveman Deep Research — Agent Communication Optimization

> Source: `source/caveman/` (github.com/JuliusBrussee/caveman)
> Date: 2026-05-08
> Purpose: Apply caveman patterns to optimize pi-crew inter-agent communication

---

## 1. Executive Summary

Caveman là một hệ thống **token compression** cho AI coding agents. Core insight: **LLM output trung bình 65-75% là filler** (articles, hedging, pleasantries). Bỏ filler → giảm token, tăng tốc, giảm cost, **không mất accuracy** (thậm chí tăng 26% theo paper arXiv:2604.00025).

**Áp dụng cho pi-crew**: Worker output được inject vào main context của Pi parent. Nếu worker output dùng caveman-style → main context live lâu hơn, nhiều task hơn per session.

---

## 2. Architecture Overview

```
caveman/
├── skills/           # Behavior definition (SKILL.md)
│   ├── caveman/      # Core: intensity levels, rules
│   ├── cavecrew/     # Decision guide for delegation
│   ├── caveman-commit/   # Terse commit messages
│   ├── caveman-review/   # One-line PR reviews
│   ├── caveman-help/     # Quick-reference card
│   ├── caveman-stats/    # Token usage tracker
│   └── compress/     # Memory file compression
├── agents/           # Subagent definitions
│   ├── cavecrew-investigator.md  # Read-only locator (haiku)
│   ├── cavecrew-builder.md       # 1-2 file surgical editor
│   └── cavecrew-reviewer.md      # Diff reviewer (haiku)
├── hooks/            # Claude Code integration
│   ├── caveman-activate.js       # SessionStart: inject rules
│   ├── caveman-mode-tracker.js   # Per-turn reinforcement
│   ├── caveman-config.js         # Shared config + symlink-safe I/O
│   └── caveman-stats.js          # Lifetime token tracking
├── mcp-servers/
│   └── caveman-shrink/           # MCP middleware proxy
├── caveman-compress/             # File compression tool
│   └── scripts/
│       ├── compress.py   # Orchestrator
│       ├── validate.py   # Structural preservation validator
│       └── detect.py     # File type detection
├── evals/            # Three-arm eval harness
└── benchmarks/       # Real API token counts
```

---

## 3. Core Patterns Applicable to pi-crew

### 3.1 Structured Output Contracts (KEY INSIGHT)

Caveman's biggest innovation is not the compression itself — it's the **output contracts**:

**investigator**: `path:line — symbol — ≤6 word note`
**builder**: `path:line-range — change ≤10 words. verified: re-read OK.`
**reviewer**: `path:line: emoji severity: problem. fix.`

These are **machine-parseable** — main thread can grep with regex, no ambiguity.

**pi-crew application**: Worker prompt templates should include structured output contracts:
```
# Output Contract
Your response MUST follow this format:
<artifact_path>:<line_range> — <≤10 word change summary>
verified: <re-read OK | mismatch @ path:line>
```

### 3.2 Context Budget Awareness

Caveman's core thesis: **subagent tool-results get injected into main context verbatim**. Every token a subagent emits is a token the main agent can't use later.

Quantified impact:
- Vanilla `Explore` subagent: ~2000 tokens per result
- `cavecrew-investigator`: ~700 tokens per result
- Over 20 delegations: **26,000 tokens saved** = entire context window of a small model

**pi-crew application**: Worker output gets read back by Pi parent via `readFile(artifactPath)`. If workers emit caveman-style output → Pi parent can process more tasks per session before context exhaustion.

### 3.3 Intensity Levels

| Level | Token Savings | When to Use |
|-------|--------------|-------------|
| lite | ~40% | User-facing summaries, final reports |
| full | ~65% | Inter-agent communication (default) |
| ultra | ~75% | Internal worker → coordinator messages |

**pi-crew application**: Add `outputStyle` to worker prompts:
- explorer → ultra (only paths/symbols needed)
- executor → full (some explanation needed for verification)
- reviewer → full (findings must be clear)
- writer → lite (user reads output directly)

### 3.4 Auto-Clarity Rule

Caveman drops compression for:
- Security warnings
- Irreversible action confirmations
- Multi-step sequences with ambiguous ordering
- User confusion / repeated questions

**pi-crew application**: Worker prompts should include auto-clarity override:
```
Drop compression for: security findings, destructive operations,
ambiguous multi-step instructions. Resume compression after.
```

### 3.5 MCP Proxy Compression (caveman-shrink)

`caveman-shrink` wraps any MCP server, compresses `description` fields in `tools/list` responses:

```
Before: "This tool allows you to search for files in the filesystem..."
After:  "Search files in filesystem."
```

**pi-crew application**: pi-crew's MCP proxy (`mcp-proxy.ts`) could compress tool descriptions before passing to workers, reducing input token cost per tool call.

---

## 4. Compression Techniques

### 4.1 Protected Segments (from compress.js)

```javascript
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,           // fenced code blocks
  /`[^`\n]+`/g,                // inline code
  /\bhttps?:\/\/\S+/gi,        // URLs
  /\b[\w.-]*[\/\\][\w.\/\\-]+/g, // paths
  /\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b/g, // CONST_CASE
  /\b\w+\.\w+(?:\.\w+)*\(\)?/g,   // dotted.method()
  /[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g, // function calls
  /\b\d+\.\d+\.\d+\b/g,       // version numbers
];
```

Process: Replace protected segments with sentinels → compress remaining prose → restore sentinels.

### 4.2 Prose Compression Rules

```javascript
// Remove categories:
FILLERS: just, really, basically, actually, simply, quite, very, essentially, literally
PLEASANTRIES: please, kindly, thank you, thanks, sure, certainly, of course
HEDGES: perhaps, maybe, might, could potentially, would like to, I think
LEADERS: I'll, I will, I can, you can, we will, let me, let's
ARTICLES: a, an, the (before lowercase words)

// Pattern: [thing] [action] [reason]. [next step].
```

### 4.3 Validation (from validate.py)

After compression, validate:
- Heading count and order preserved
- Code blocks byte-identical
- URLs preserved exactly
- File paths preserved
- Inline code preserved
- Bullet structure maintained (±15% tolerance)

**pi-crew application**: When workers produce structured output, validate format before injecting into parent context. Bad format → retry with targeted fix (caveman's "cherry-pick fix" pattern).

---

## 5. Delegation Decision Matrix (from cavecrew)

| Task | Use | Why |
|------|-----|-----|
| "Where is X defined" | investigator | Read-only, structured paths |
| Same + suggestions | vanilla Explore | Need prose |
| 1-2 file surgical edit | builder | Bounded scope |
| 3+ file refactor | main thread | Builder refuses |
| Review diff for bugs | reviewer | One-line findings |
| Deep code review | vanilla Code Reviewer | Need rationale |

**pi-crew application**: Planner agent should use similar decision matrix when assigning tasks to workers. Key rule: **if output will be consumed by another agent, compress it. If a human reads it, use normal prose.**

---

## 6. Security Patterns (from caveman-config.js)

### 6.1 Symlink-Safe File I/O

```javascript
// Flag file write pattern:
1. Check parent dir is not symlink (or resolve + verify ownership)
2. Check target file is not symlink
3. Write to temp file with O_NOFOLLOW | O_EXCL
4. fchmod 0600
5. rename temp → target (atomic)
```

**pi-crew application**: pi-crew's `atomic-write.ts` should adopt similar symlink guards, especially for `agents.json` (the file that caused the ghost agent bug).

### 6.2 Sensitive File Detection (from compress.py)

```python
SENSITIVE_BASENAMES = .env, .netrc, credentials, secrets, passwords, id_rsa, *.pem, *.key
SENSITIVE_DIRS = .ssh, .aws, .gnupg, .kube, .docker
SENSITIVE_TOKENS = secret, credential, password, apikey, token, privatekey
```

**pi-crew application**: Workers should refuse to read/compress files matching these patterns. Add to worker prompt constraints.

---

## 7. Eval Methodology

### Three-Arm Harness

| Arm | System Prompt | Purpose |
|-----|--------------|---------|
| `__baseline__` | none | Raw model output |
| `__terse__` | "Answer concisely." | Control for generic terseness |
| `<skill>` | "Answer concisely." + SKILL.md | Isolated skill contribution |

**Honest delta = skill vs terse, NOT skill vs baseline.**

**pi-crew application**: When measuring worker efficiency, compare against "answer concisely" control, not against verbose baseline. This avoids claiming compression wins that are just generic terseness.

---

## 8. Specific pi-crew Integration Plan

### Phase 1: Structured Output Contracts ✅ DONE

Commit `a335dfc`. Implemented `buildOutputContract(role)` in `live-session-runtime.ts`.
Explorer, executor, reviewer, security-reviewer, verifier, writer all have structured format templates.

### Phase 2: Prose Compression in Worker Prompts ✅ DONE

Commit `a335dfc`. Implemented `buildCommunicationStyle(role)` with lite/full/ultra levels.
Explorer = ultra, writer = lite, all others = full.

### Phase 3: Tool Description Compression ✅ DONE

Commit `pending`. Created `prose-compressor.ts` — pure TypeScript implementation of caveman's compress.js.
Compressed custom tool descriptions (submit_result, irc).
SDK-managed tool descriptions need Pi SDK support for mutation (documented as `compressSessionToolDescriptions` stub).

### Phase 4: Output Validation ✅ DONE

Created `output-validator.ts` with:
- `validateWorkerOutput(role, output)` — checks format + structural preservation
- `parseReviewerFindings(output)` — extracts structured findings from reviewer output
- `parseExplorerResults(output)` — extracts structured results from explorer output
- `validateCompressionPreservation(original, compressed)` — checks code blocks, URLs, inline code, headings

### Phase 5: Intensity by Role ✅ DONE

Commit `a335dfc`. `ROLE_INTENSITY` map in `live-session-runtime.ts`.

---

## 9. Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Avg worker output tokens | ~800 | ~300 | **62%** |
| Parent context capacity (tasks/session) | ~15 | ~30 | **2x** |
| Tool description tokens (input) | ~200/tool | ~80/tool | **60%** |
| Review finding parse accuracy | ~70% | ~95% | **+25%** |

---

## 10. Key Takeaways

1. **Output contracts > compression** — structured format is the real win, not shorter prose ✅
2. **Context budget is finite** — every worker token = one less parent token ✅
3. **Validate, don't trust** — compress then validate structural preservation ✅
4. **Auto-clarity > always-compress** — security/destructive = normal English ✅
5. **Three-arm eval** — measure against "be concise" control, not verbose baseline 📋
6. **Symlink-safe I/O** — protect predictable file paths from symlink attacks ✅
7. **Sensitive file denylist** — never ship credentials to third-party APIs ✅
8. **Role-based intensity** — explorer gets ultra, writer gets lite, executor gets full ✅
9. **Tool description compression** — compress descriptions to reduce input tokens ✅ (SDK support pending)
10. **Parse structured output** — extract findings/results from worker output ✅
