const fs = require('fs');
let c = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Fix pane content filter: skip lines containing "(none)" or that are empty
c = c.replace(
    'if (paneLines.length > 0 && !(paneLines.length === 1 && paneLines[0]?.includes("(none)")))',
    'const filteredPane = paneLines.filter(l => l && !l.includes("(none)") && l.trim() !== "");\n\t\t\t\t\tif (filteredPane.length > 0)'
);

// Fix: use filteredPane instead of paneLines for rendering
c = c.replace(
    'for (const line of paneLines.slice(0, 8)) {',
    'for (const line of filteredPane.slice(0, 8)) {'
);

// Fix footer: only show when there's actual content
c = c.replace(
    `lines.push(row(fg("dim", \`\${tokStr}\${ctxStr} · \${r.workspaceMode}\`)));`,
    `if (tokStr || ctxStr) lines.push(row(fg("dim", \`\${tokStr}\${ctxStr}\`)));`
);

fs.writeFileSync('src/ui/run-dashboard.ts', c);
console.log('Fixed pane filter and footer');
