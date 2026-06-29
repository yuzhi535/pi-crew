---
name: pipeline
description: Multi-stage pipeline with automatic fan-out for array inputs
topology: sequential
---

## Stage 1: Research
role: explorer

Perform initial research on: {goal}. Gather relevant information, identify key concepts, and provide a structured summary.

## Stage 2: Analysis
role: analyst
dependsOn: Stage 1

Analyze the research findings from Stage 1. Identify patterns, relationships, and insights. Provide structured analysis with supporting evidence.

## Stage 3: Synthesis
role: analyst
dependsOn: Stage 2

Synthesize the analysis into actionable recommendations. Prioritize findings and provide clear next steps.

## Stage 4: Documentation
role: writer
dependsOn: Synthesis

Document the complete findings in a clear, well-structured format. Include executive summary, detailed findings, and recommendations.
