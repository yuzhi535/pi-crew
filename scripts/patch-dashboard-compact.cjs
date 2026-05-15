const fs = require('fs');
let content = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');
const normalized = content.replace(/\r\n/g, '\n');

// Find and replace renderUnsafe
const startMarker = '\tprivate renderUnsafe(width: number): string[] {';
const startIdx = normalized.indexOf(startMarker);
if (startIdx < 0) { console.error('Cannot find renderUnsafe'); process.exit(1); }

let braceCount = 0;
let endIdx = -1;
for (let i = startIdx; i < normalized.length; i++) {
    if (normalized[i] === '{') braceCount++;
    if (normalized[i] === '}') {
        braceCount--;
        if (braceCount === 0) { endIdx = i + 1; break; }
    }
}
if (endIdx < 0) { console.error('Cannot find end'); process.exit(1); }

const newMethod = `\tprivate renderUnsafe(width: number): string[] {
\t\tthis.refreshRuns();
\t\tconst signature = this.buildSignature();
\t\tif (signature !== this.cachedVersion || this.cachedWidth !== width) {
\t\t\tconst innerWidth = Math.max(20, width - 4);
\t\t\tconst borderWidth = Math.min(innerWidth, Math.max(0, width - 2));
\t\t\tconst fg = (color: Parameters<CrewTheme["fg"]>[0], text: string) => this.theme.fg(color, text);
\t\t\tconst borderFill = (count: number) => new DynamicCrewBorder(this.theme).render(count)[0];
\t\t\tconst border = (left: string, right: string) => \`\${fg("border", left)}\${borderFill(borderWidth)}\${fg("border", right)}\`;
\t\t\tconst row = (text: string) => \`│ \${pad(truncate(text, innerWidth - 1), innerWidth - 1)}│\`;
\t\t\tconst sep = () => border("├", "┤");
\t\t\t
\t\t\tconst lines: string[] = [
\t\t\t\tborder("╭", "╮"),
\t\t\t\trow(\`\${fg("accent", "▐")} \${this.theme.bold("pi-crew")}  \${fg("dim", "1-6 pane · ↑↓ · Enter · Esc")}\`),
\t\t\t\tsep(),
\t\t\t];

\t\t\tif (this.runs.length === 0) {
\t\t\t\tlines.push(row(fg("dim", "No runs.")));
\t\t\t} else {
\t\t\t\t// Run list (max 8 lines)
\t\t\t\tconst rows = groupedRuns(this.runs, this.options.snapshotCache).slice(0, 8);
\t\t\t\tconst selectableRuns = rows.filter((r) => r.run);
\t\t\t\tfor (const r of rows) {
\t\t\t\t\tif (!r.run) { lines.push(row(fg("dim", \`── \${r.label} ──\`)); continue; }
\t\t\t\t\tconst idx = selectableRuns.findIndex((c) => c.run?.runId === r.run?.runId);
\t\t\t\t\tconst snap = snapshotFor(r.run, this.options.snapshotCache);
\t\t\t\t\tconst run = snap?.manifest ?? r.run;
\t\t\t\t\tconst agents = snap?.agents ?? agentsFor(r.run, this.options.snapshotCache);
\t\t\t\t\tconst status: RunStatus = isLikelyOrphanedActiveRun(run, agents) ? "stale" : (run.status as RunStatus);
\t\t\t\t\tconst label = runLabel(run, idx === this.selected, this.options.snapshotCache);
\t\t\t\t\tlines.push(row(applyStatusColor(this.theme, status, label)));
\t\t\t\t}

\t\t\t\t// Selected run detail — compact
\t\t\t\tconst selectedRun = selectedRunFromGrouped(this.runs, this.selected, this.options.snapshotCache);
\t\t\t\tif (selectedRun) {
\t\t\t\t\tconst snap = snapshotFor(selectedRun, this.options.snapshotCache);
\t\t\t\t\tconst r = snap?.manifest ?? selectedRun;
\t\t\t\t\tconst agents = snap?.agents ?? agentsFor(selectedRun, this.options.snapshotCache);
\t\t\t\t\tconst statusStr = isLikelyOrphanedActiveRun(r, agents) ? "stale" : r.status;
\t\t\t\t\tlines.push(sep());
\t\t\t\t\tlines.push(row(\`\${fg("accent", "▸")} \${truncate(r.goal, innerWidth - 6)}\`));
\t\t\t\t\tlines.push(row(fg("dim", \`  \${r.team}/\${r.workflow ?? "default"} · \${statusStr} · \${r.runId.slice(-10)}\`)));

\t\t\t\t\t// Pane content (max 8 lines)
\t\t\t\t\tconst paneLines = snap
\t\t\t\t\t\t? this.activePane === "agents" ? renderAgentsPane(snap, this.options)
\t\t\t\t\t\t: this.activePane === "progress" ? renderProgressPane(snap)
\t\t\t\t\t\t: this.activePane === "mailbox" ? renderMailboxPane(snap)
\t\t\t\t\t\t: this.activePane === "health" ? renderHealthPane(snap, { isForeground: !r.async })
\t\t\t\t\t\t: this.activePane === "metrics" ? renderMetricsPane(snap, { registry: this.options.registry })
\t\t\t\t\t\t: renderTranscriptPane(snap)
\t\t\t\t\t\t: [
\t\t\t\t\t\t\t...readAgentPreview(r, 4, this.options),
\t\t\t\t\t\t\t...readProgressPreview(r, 2),
\t\t\t\t\t\t];
\t\t\t\t\tif (paneLines.length > 0 && !(paneLines.length === 1 && paneLines[0]?.includes("(none)"))) {
\t\t\t\t\t\tlines.push(row(fg("dim", \`── \${this.activePane} ──\`)));
\t\t\t\t\t\tfor (const line of paneLines.slice(0, 8)) {
\t\t\t\t\t\t\tlines.push(row(truncate(line, innerWidth - 2)));
\t\t\t\t\t\t}
\t\t\t\t\t}

\t\t\t\t\t// One-line footer
\t\t\t\t\tconst selectedTasks = snap?.tasks ?? readRunTasks(r, this.options.snapshotCache);
\t\t\t\t\tconst usage = aggregateUsage(selectedTasks);
\t\t\t\t\tconst tok = (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
\t\t\t\t\tconst tokStr = tok > 0 ? (tok >= 1000 ? \`\${(tok/1000).toFixed(1)}k tok\` : \`\${tok} tok\`) : "";
\t\t\t\t\tlet ctxPct: number | undefined;
\t\t\t\t\tfor (const agent of agents) {
\t\t\t\t\t\tif (agent.status === "running" && agent.runtime === "live-session") {
\t\t\t\t\t\t\tconst pct = getLiveAgentContextPercent(agent.taskId);
\t\t\t\t\t\t\tif (pct != null) { ctxPct = pct; break; }
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\tconst ctxStr = ctxPct != null ? \` · \${Math.round(ctxPct)}% ctx\` : "";
\t\t\t\t\tlines.push(row(fg("dim", \`\${tokStr}\${ctxStr} · \${r.workspaceMode}\`)));
\t\t\t\t}
\t\t\t}
\t\t\tlines.push(border("╰", "╯"));
\t\t\tthis.cachedLines = renderLines(lines.map((line) => truncate(line, width)), width);
\t\t\tthis.cachedVersion = signature;
\t\t\tthis.cachedWidth = width;
\t\t}
\t\treturn this.cachedLines;
\t}`;

content = normalized.slice(0, startIdx) + newMethod + normalized.slice(endIdx);
fs.writeFileSync('src/ui/run-dashboard.ts', content);
console.log('Rewrote dashboard renderUnsafe (compact)');
