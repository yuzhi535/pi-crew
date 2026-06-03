---
name: detection-pipeline-design
description: "Design data pipelines for security monitoring and threat intelligence."
origin: distilled:anthropic-cybersecurity-skills
triggers:
  - "build pipeline"
  - "design detection"
  - "setup monitoring"
  - "enrich data"
  - "threat intelligence"
---
# detection-pipeline-design

Use this skill when designing data pipelines for security detection and enrichment.

## Source

Distilled from `building-ioc-enrichment-pipeline-with-opencti` (Anthropic Cybersecurity Skills) and generalized for software/build context.

## When to Use

- Building detection and monitoring systems
- Designing security data pipelines
- Setting up automated threat intelligence
- Creating alert enrichment workflows
- Integrating security scanning into CI/CD

## Pipeline Architecture

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐
│  Input  │ → │ Transform│ → │  Enrich  │ → │  Score  │ → │  Route  │
│  Data   │    │  (Norm)  │    │ (Context)│    │ (Conf)  │    │(Action) │
└─────────┘    └──────────┘    └──────────┘    └─────────┘    └─────────┘
                                    ↓
                              ┌──────────┐
                              │  Output  │
                              │ Findings │
                              └──────────┘
```

## Pipeline Components

### 1. Input Stage

```yaml
input:
  types:
    - name: file_change
      sources: [git, filesystem]
    - name: log_event
      sources: [application, system]
    - name: alert
      sources: [scanner, monitor]
    - name: dependency
      sources: [npm, pip, cargo]
  format: [json, plain_text, structured]
  polling: [real_time, batch, scheduled]
```

### 2. Transform Stage

```yaml
transform:
  operations:
    - name: normalize
      description: Convert to standard format
      output: stix_like_object
    - name: extract_indicators
      description: Pull out IOCs
      extract: [ips, domains, hashes, credentials, tokens]
    - name: enrich_metadata
      description: Add context
      add: [file_type, language, framework, timestamp]
  output_format: json
```

### 3. Enrich Stage

```yaml
enrich:
  internal_sources:
    - name: vulnerability_db
      query: [cve_id, cwe]
    - name: code_analysis
      query: [pattern, structure]
    - name: git_history
      query: [author, commit, diff]
  external_sources:
    - name: npm_audit
      api: npmjs.org
    - name: osv
      api: osv.dev
    - name: gh_advisory
      api: github.com/advisories
  async: true
  timeout_ms: 5000
```

### 4. Score Stage

```yaml
score:
  confidence_calculation:
    factors:
      - name: source_reliability
        weight: 0.3
        scale: [0-10]
      - name: contextual_evidence
        weight: 0.4
        scale: [0-10]
      - name: historical_matches
        weight: 0.3
        scale: [0-10]
  formula: >
    (reliability * 0.3) + 
    (evidence * 0.4) + 
    (historical * 0.3)
  thresholds:
    critical: [90-100]
    high: [70-89]
    medium: [40-69]
    low: [0-39]
```

### 5. Route Stage

```yaml
route:
  paths:
    - condition: "score >= 90"
      action: [alert, block, notify]
      destination: [security_team, incident_response]
    - condition: "score >= 70"
      action: [alert, review]
      destination: [security_queue]
    - condition: "score >= 40"
      action: [log, monitor]
      destination: [security_logs]
    - condition: "score < 40"
      action: [ignore]
      destination: []
```

## Pipeline Design Patterns

### Pattern 1: Real-time File Monitoring

```yaml
pipeline:
  name: file-change-detection
  trigger:
    type: filesystem_watch
    paths: ["src/**/*.ts", "src/**/*.js"]
  transform:
    - extract: [imports, function_calls, secrets]
  enrich:
    - check: npm_audit
    - check: known_vulnerable_patterns
  score:
    - base: vulnerability_severity
    - modifier: exploitability
  route:
    critical: slack_alert + block_merge
    high: github_issue + notify
    medium: log + track
```

### Pattern 2: Dependency Vulnerability Pipeline

```yaml
pipeline:
  name: dependency-vuln-scan
  trigger:
    type: package_lock_change
  transform:
    - extract: [package_names, versions, sources]
  enrich:
    - query: osv_database
    - query: npm_advisories
    - query: github_advisories
  score:
    - base: cvss_score
    - modifier: [has_exploit, is_dependencies]
  route:
    critical: [create_security_issue, alert_team]
    high: [create_issue, schedule_fix]
    medium: [add_to_backlog]
    low: [note_in_changelog]
```

### Pattern 3: Secret Detection Pipeline

```yaml
pipeline:
  name: secret-detection
  trigger:
    type: git_push
  transform:
    - extract: [api_keys, tokens, passwords, credentials]
  enrich:
    - validate: key_format
    - check: blacklists
  score:
    - base: key_validity
    - modifier: [key_age, exposure_scope]
  route:
    critical: [revoke_key, alert_security, block_push]
    high: [notify_owner, rotate_key]
    medium: [flag_for_review]
    low: [log]
```

## Implementation Example

```typescript
interface DetectionPipeline {
  name: string;
  input: InputConfig;
  transform: TransformConfig;
  enrich: EnrichConfig;
  score: ScoreConfig;
  route: RouteConfig;
}

async function runPipeline(pipeline: DetectionPipeline, data: unknown): Promise<PipelineResult> {
  // 1. Input validation
  const normalized = normalizeInput(data, pipeline.input);
  
  // 2. Transform - extract indicators
  const indicators = extractIndicators(normalized, pipeline.transform);
  
  // 3. Enrich - query external/internal sources
  const enriched = await enrichIndicators(indicators, pipeline.enrich);
  
  // 4. Score - calculate confidence
  const scored = calculateScore(enriched, pipeline.score);
  
  // 5. Route - determine action
  const action = determineAction(scored, pipeline.route);
  
  return { indicators, enriched, scored, action };
}
```

## Enforcement — Detection Pipeline Design Gate

**Before deploying detection pipelines, verify:**

- [ ] Input format validated before transform stage
- [ ] Scoring thresholds tuned to environment (not hardcoded defaults)
- [ ] Confidence calculation includes multiple factors (reliability, evidence, history)
- [ ] Route actions match score thresholds (critical → block, low → ignore)
- [ ] False positive rate measured and acceptable
- [ ] External API calls are async (non-blocking)

If ANY answer is NO → Stop. Tune the pipeline before deploying.

## Anti-Patterns

- **Don't** skip input validation (garbage in, garbage out)
- **Don't** skip enrichment (missing context leads to false positives)
- **Don't** use fixed thresholds (tune based on environment)
- **Don't** ignore false positive rates (kills analyst productivity)
- **Don't** block on external APIs in synchronous path (use async)

## Tools & Integrations

| Tool | Pipeline Role |
|------|---------------|
| `semgrep` | Static analysis, pattern matching |
| `npm audit` | Dependency vulnerability |
| `trufflehog` | Secret scanning |
| `grype` | Container vulnerability |
| `syft` | SBOM generation |

## Verification

For pipeline design changes:
```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/detection-pipeline.test.ts
```

*See also: `security-review` skill for detection rule patterns and signature authoring guidance.*