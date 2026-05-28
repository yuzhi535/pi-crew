---
name: security-review
description: "\"Security review patterns with audit and detection authoring. Use when reviewing code security, running compliance audits, building detection rules, or vulnerability assessments. Triggers: security review, vulnerability scan, audit, pen test, build detection rule, compliance check.\""

---
# Security Review Skill

**Version:** 1.0.0
**Author:** pi-crew team
**Source:** `source/Anthropic-Cybersecurity-Skills/` distillation

## Overview

Security review patterns for pi-crew multi-agent orchestration.
Based on MITRE ATLAS v5.4, NIST AI RMF, and Anthropic Cybersecurity Skills.

## TRIGGERS

Trigger this skill when:
- User requests: "security review", "vulnerability scan", "audit", "pen test"
- Keywords: security, vulnerability, auth, owasp, injection, xss, csrf, exploit
- Actions: `team action='run', team='review'`
- High-risk tasks routed by autonomous policy

## Audit Finding Prioritization (from benchmark-based auditing)

Use audit frameworks to systematically assess security posture:

### Audit Workflow

```markdown
## Audit Process

1. **Select Standard** → [CIS, OWASP-Top10, SOC2, NIST, custom]
2. **Identify Controls** → Which security controls to check
3. **Run Checks** → Automated (Semgrep, npm audit) or manual inspection
4. **Document Findings** → [passed, failed, warning, info]
5. **Calculate Score** → Compliance: [X/Y passed as percentage]
6. **Prioritize** → By risk: [Critical, High, Medium, Low]
7. **Remediate** → Fix in priority order
8. **Verify** → Confirm fixes resolved findings
```

### Audit Finding Structure

```yaml
audit_finding:
  control_id: string          # e.g., "CIS-1.1", "OWASP-A1"
  control_name: string         # Human-readable name
  status: [pass|fail|warning|info|not_applicable]
  severity: [critical|high|medium|low]
  evidence:
    - file: string            # File with issue
      line: number
      description: string
  recommendation: string     # How to fix
  effort: [low|medium|high]  # Implementation effort
  benefit: [low|medium|high] # Security improvement
```

### Prioritization Matrix

| Severity \ Effort | Low | Medium | High |
|-------------------|-----|--------|------|
| **Critical** | Fix now | Fix now | Priority |
| **High** | Fix now | Priority | Schedule |
| **Medium** | Priority | Schedule | Later |
| **Low** | Schedule | Later | Later |

Sort by: severity DESC, effort ASC, benefit DESC

### Audit Check Examples

```bash
# OWASP Top 10 check
semgrep --config=owasp-top-10 .

# Dependency audit
npm audit --audit-level=high

# Secrets detection
trufflehog3 filesystem .

# CIS Benchmark (cloud)
prowler aws --output-format json
```

## Detection Signature Authoring (from detection rule building)

Build detection rules to identify vulnerabilities and attack patterns:

### Detection Workflow

```markdown
## Detection Authoring Process

1. **Identify Target** → What to detect: [vulnerability, pattern, anomaly]
2. **Define Source** → Where to look: [files, logs, events, network]
3. **Create Pattern** → Match logic: [regex, AST pattern, rule]
4. **Tune** → Adjust thresholds: [reduce noise, increase sensitivity]
5. **Test** → Validate: [true positive, false positive rate]
6. **Deploy** → Activate monitoring: [hook, alert, block]
7. **Monitor** → Track: [alerts triggered, quality]
```

### Detection Rule Structure

```yaml
detection:
  name: string
  description: string
  severity: [critical|high|medium|low]
  target:
    type: [vulnerability|pattern|anomaly]
    techniques: [MITRE ATT&CK IDs]
  source:
    - type: [file|log|network|event]
      locations: [path, glob, endpoint]
  pattern:
    type: [regex|AST|signature|heuristic]
    match: string_or_structure
    exclude: [false_positive_patterns]
  threshold:
    count: int
    time_window: duration
  response:
    alert: [severity, message]
    block: boolean
    log: boolean
  tuning:
    false_positives: [known_noise]
    sensitivity: [high|medium|low]
  validation:
    test_cases:
      - input: string
        expected: [match|no_match]
    true_positive_rate: float
    false_positive_rate: float
```

### Detection Rule Examples

```yaml
# SQL Injection Detection
detection:
  name: sql-injection-pattern
  severity: critical
  pattern:
    type: regex
    match: '(union|select|insert|update|delete).*from'
    exclude:
      - '// comment with select'
      - 'userProvidedQuery = "safe_value"'

# Log4j Detection (CVE-2021-44228)
  pattern:
    type: regex
    match: '\$\{jndi:ldap://'

# Sensitive Data in Logs
  pattern:
    type: regex
    match: '(password|secret|token|key)\s*[=:]\s*["\']?[\w+/]{20,}'
```

## ENFORCE

### Gate 1: PATH TRAVERSAL (RED → GREEN)
```
RED: Any unvalidated path operation (read/write/exec)
YELLOW: Path validated but without symlink check
GREEN: Path validated with assertSafePathId() + resolveRealContainedPath()
```

### Gate 2: PROMPT INJECTION (RED → Green)
```
RED: Untrusted input passed to model without sanitization
YELLOW: Partial sanitization (regex only, no context markers)
GREEN: Full sanitization with injection markers + context isolation
```

### Gate 3: SECRET EXPOSURE (RED → Green)
```
RED: *** values visible in logs/artifacts/transcripts
YELLOW: Partial redaction (logs only, not artifacts)
GREEN: Full redaction via redactEvent(), sanitizeEnvSecrets()
```

### Gate 4: SUPPLY CHAIN (RED → Green)
```
RED: Dependencies from untrusted sources without verification
YELLOW: Lockfile checked but package integrity not verified
GREEN: Package integrity verified + npm audit + typosquatting check
```

## PATTERNS

### Pattern 1: Agent Context Poisoning Detection

**MITRE ATLAS:** AML.T0051 (Prompt Injection), AML.T0054 (Jailbreak)

```typescript
// Check for injection markers in user input
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget)\s+(previous|all|above)\s+(instructions|prompts)/i,
  /\b(you\s+are\s+now|act\s+as|pretend)\s+\w+/i,
  /<\s*script\s*>/i,
  /\{\{.*?\}\}/,  // Template injection
  /\$\{.*?\}/,    // Variable injection
  /\[\s*system\s*\]/i,
  /\[\s*assistant\s*\]/i,
];

function detectInjection(input: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(input));
}

// Check task packet for poisoned context
function validateTaskPacket(packet: TaskPacket): ValidationResult {
  const injections = detectInjection(packet.prompt);
  if (injections) {
    return {
      severity: 'critical',
      category: 'prompt-injection',
      evidence: packet.prompt,
      recommendation: 'Sanitize input with injection markers',
    };
  }
  return { severity: 'pass', category: 'context-integrity', evidence: null };
}
```

### Pattern 2: Path Traversal Prevention

**MITRE ATLAS:** ATT&CK T1059 (Command & Scripting Interpreter)

```typescript
import { assertSafePathId, resolveContainedPath } from '../utils/safe-paths.ts';

function safeFileOperation(path: string, cwd: string): SafePathResult {
  // Step 1: Validate path ID format
  assertSafePathId(path);

  // Step 2: Resolve to absolute with containment
  const resolved = resolveContainedPath(path, cwd);

  // Step 3: Verify resolved path is within cwd
  if (!resolved.startsWith(cwd)) {
    return {
      safe: false,
      reason: 'Path escapes working directory',
      resolved: undefined,
    };
  }

  return {
    safe: true,
    resolved,
    reason: 'Path validated and contained',
  };
}
```

### Pattern 3: Supply Chain Security

**MITRE ATLAS:** AML.T0010 (Supply Chain), AML.T0104 (Software Supply Chain)

```typescript
const TRUSTED_NPM_SOURCES = [
  'registry.npmjs.org',
  'registry.npmmirror.com',
];

function validateNpmPackage(manifest: PackageManifest): ValidationResult {
  // Check for typosquatting
  const suspiciousNames = detectTyposquatting(manifest.name);
  if (suspiciousNames.length > 0) {
    return {
      severity: 'high',
      category: 'typosquatting',
      evidence: `Package name similar to: ${suspiciousNames.join(', ')}`,
    };
  }

  // Check for post-install scripts
  if (manifest.scripts?.postinstall && !isTrustedSource(manifest)) {
    return {
      severity: 'medium',
      category: 'supply-chain',
      evidence: 'Post-install script detected',
    };
  }

  // Check dependencies
  const dangerousDeps = findDangerousDependencies(manifest.dependencies);
  if (dangerousDeps.length > 0) {
    return {
      severity: 'high',
      category: 'dependency-confusion',
      evidence: dangerousDeps,
    };
  }

  return { severity: 'pass', category: 'supply-chain', evidence: null };
}
```

### Pattern 4: Secret Redaction

**MITRE ATLAS:** AML.T0067 (Exfiltrate Training Data)

```typescript
import { redactEvent } from '../state/event-log.ts';

const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|secret|token|password|credential)["\s]*[=:]["\s]*[A-Za-z0-9+/]{20,}/gi,
  /\b(?:ghp|github)_[A-Za-z0-9]{36,}/g,
  /\bBearer\s+[A-Za-z0-9+/=_.-]{20,}/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,  // Generic long base64
];

function redactSecrets(content: string): string {
  let redacted = content;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '***REDACTED***');
  }
  return redacted;
}

// Apply to all event types
function safeLogEvent(event: CrewEvent): void {
  const redacted = redactEvent(event);  // Built-in redaction
  appendEvent(redacted);
}
```

### Pattern 5: Race Condition Detection

**MITRE ATLAS:** AML.T0054 (Privilege Escalation via Race)

```typescript
// Detect timing attacks and race conditions
const RACE_CONDITION_PATTERNS = [
  { pattern: /appendFileSync.*race/i, severity: 'medium' },
  { pattern: /readFileSync.*writeFileSync.*race/i, severity: 'high' },
  { pattern: /mkdirSync.*mkdir.*race/i, severity: 'medium' },
];

function detectRaceConditions(code: string): Finding[] {
  const findings: Finding[] = [];

  // Check for file operation races
  for (const { pattern, severity } of RACE_CONDITION_PATTERNS) {
    if (pattern.test(code)) {
      findings.push({
        severity,
        category: 'race-condition',
        pattern: pattern.source,
        recommendation: 'Use atomic write or filesystem locking',
      });
    }
  }

  // Check for timing-sensitive operations
  if (code.includes('setTimeout') && code.includes('auth')) {
    findings.push({
      severity: 'medium',
      category: 'timing-attack',
      recommendation: 'Add constant-time comparison for auth checks',
    });
  }

  return findings;
}
```

### Pattern 6: Authentication Anomaly Detection

**MITRE ATLAS:** AML.T0043 (Auth Failure), AML.T0018 (Token Theft)

```typescript
interface AuthPattern {
  sessionId: string;
  timestamp: number;
  failures: number;
  source: string;
}

function detectAuthAnomalies(sessions: AuthPattern[]): Finding[] {
  const findings: Finding[] = [];

  // Brute force detection
  for (const session of sessions) {
    if (session.failures > 5) {
      findings.push({
        severity: 'high',
        category: 'brute-force',
        evidence: `${session.failures} auth failures from ${session.source}`,
      });
    }

    // Token reuse detection
    if (session.timestamp < Date.now() - 3600000) {
      findings.push({
        severity: 'medium',
        category: 'token-reuse',
        evidence: 'Stale session token used',
      });
    }
  }

  // Session fixation
  const predictableIds = sessions.filter(s =>
    /^(session|team|run)_[a-z0-9]{8}$/i.test(s.sessionId)
  );
  if (predictableIds.length > 0) {
    findings.push({
      severity: 'medium',
      category: 'session-fixation',
      evidence: 'Predictable session ID pattern detected',
    });
  }

  return findings;
}
```

### Pattern 7: Tool Invocation Abuse Detection

**MITRE ATLAS:** AML.T0051 (Prompt Injection)

```typescript
interface ToolMetrics {
  toolName: string;
  callCount: number;
  timeWindow: number;
  anomalies: string[];
}

function detectToolAbuse(metrics: ToolMetrics[]): Finding[] {
  const findings: Finding[] = [];
  const RATE_THRESHOLD = 10; // calls per minute
  const BURST_THRESHOLD = 20; // calls in 30 seconds

  for (const metric of metrics) {
    // Rate limiting
    const rate = metric.callCount / (metric.timeWindow / 60000);
    if (rate > RATE_THRESHOLD) {
      findings.push({
        severity: 'high',
        category: 'tool-abuse',
        evidence: `${metric.toolName}: ${rate.toFixed(1)} calls/min (threshold: ${RATE_THRESHOLD})`,
        recommendation: 'Implement rate limiting or throttling',
      });
    }

    // Burst detection
    if (metric.callCount > BURST_THRESHOLD && metric.timeWindow < 30000) {
      findings.push({
        severity: 'critical',
        category: 'tool-burst',
        evidence: `${metric.toolName}: ${metric.callCount} calls in <30s`,
        recommendation: 'Block tool and investigate source',
      });
    }
  }

  return findings;
}
```

### Pattern 8: Malicious Skill Loading Detection

**MITRE ATLAS:** AML.T0062 (Exfiltrate Data via ML)

```typescript
const UNSAFE_SKILL_PATTERNS = [
  /(^|\/)\.\.(\/|$)/,                    // Path traversal
  /^[A-Z]:/i,                            // Windows absolute path
  /^\//,                                 // Unix absolute path
  /\.exe$|\.dll$|\.so$/i,                // Binary files
  /<script|SQL|SELECT.*FROM/i,           // Script injection
];

function validateSkillPath(path: string): ValidationResult {
  if (!path || path.includes('\0')) {
    return {
      safe: false,
      reason: 'Null byte or empty path',
      category: 'malicious-skill',
    };
  }

  for (const pattern of UNSAFE_SKILL_PATTERNS) {
    if (pattern.test(path)) {
      return {
        safe: false,
        reason: `Path matches unsafe pattern: ${pattern}`,
        category: 'malicious-skill',
      };
    }
  }

  // Check if skill exists and is readable
  if (!existsSync(path)) {
    return {
      safe: false,
      reason: 'Skill file does not exist',
      category: 'missing-skill',
    };
  }

  return {
    safe: true,
    reason: 'Skill path validated',
    category: 'skill-path',
  };
}
```

---

## TOOLS

| Tool | Purpose |
|------|---------|
| `assertSafePathId()` | Path ID format validation |
| `resolveContainedPath()` | Path containment resolution |
| `redactEvent()` | Event log redaction |
| `sanitizeEnvSecrets()` | Environment variable sanitization |
| `sanitizeTaskPacket()` | Task packet sanitization |
| `atomicWriteJson()` | Atomic file writes |

---

## METRICS

| Metric | Target |
|--------|--------|
| Path traversal findings | 0 critical |
| Secret exposure | 0 in any artifact |
| Supply chain issues | <5 medium |
| Race conditions | <2 medium |
| Tool abuse detection | 100% coverage |

---

*See also: `docs/distillation/cybersecurity-patterns.md`*
## Anti-Patterns

- **Don't** skip path traversal checks when dealing with user input
- **Don't** trust agent output without auditing artifacts
- **Don't** run security review without knowing the data flow boundaries
- **Don't** skip secrets detection in configuration and environment files
- **Don't** skip supply chain checks when using external packages
