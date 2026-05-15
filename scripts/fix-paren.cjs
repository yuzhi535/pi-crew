const fs = require('fs');
let c = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');
// Fix missing closing paren — the line has: fg("dim", `── ${r.label} ──`)); should be: fg("dim", `── ${r.label} ──`)));
c = c.replace(
    '{ lines.push(row(fg("dim", `',
    '{ lines.push(row(fg("dim", `'
);
// Find the exact pattern: ──`)); continue — missing one closing paren
c = c.replace(
    /lines\.push\(row\(fg\("dim", `── \$\{r\.label\} ──`\)\); continue\;/,
    'lines.push(row(fg("dim", `── ${r.label} ──`))); continue;'
);
fs.writeFileSync('src/ui/run-dashboard.ts', c);
console.log('Fixed missing paren');
