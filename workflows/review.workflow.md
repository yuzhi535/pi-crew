---
name: review
description: Review workflow for correctness and security
---

## explore
role: explorer

Identify changed or relevant areas for review: {goal}

## code-review
role: reviewer
dependsOn: explore
parallelGroup: review

Review correctness, maintainability, tests, and regressions.

## security-review
role: security-reviewer
dependsOn: explore
parallelGroup: review

Review security risks and trust boundaries.

## verify
role: verifier
dependsOn: code-review, security-review
verify: true

Summarize the review outcome. Read ONLY the specific files and lines referenced in reviewer and security-reviewer findings to confirm they exist and the findings are valid. Do NOT run npm test or full test suites. Give PASS if findings are confirmed, FAIL if any critical finding is a false positive.
