const fs = require('fs');
let c = fs.readFileSync('src/ui/run-dashboard.ts', 'utf8');

// Add run count back to header
c = c.replace(
    'row(`${fg("accent", "▐")} ${this.theme.bold("pi-crew")}  ${fg("dim", "1-6 pane · ↑↓ · Enter · Esc")}`)',
    'row(`${fg("accent", "▐")} ${this.theme.bold("pi-crew")} · ${this.runs.length} runs  ${fg("dim", "1-6 pane · ↑↓ · Enter · Esc")}`)'
);

fs.writeFileSync('src/ui/run-dashboard.ts', c);
console.log('Added run count');
