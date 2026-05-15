const fs = require('fs');
let c = fs.readFileSync('src/state/active-run-registry.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Add PID liveness check to activeRunEntries
const oldFn = `export function activeRunEntries(): ActiveRunRegistryEntry[] {
	const entries: ActiveRunRegistryEntry[] = [];
	for (const entry of readActiveRunRegistry()) {
		try {
			// Skip entries whose CWD no longer exists (temp test dirs, deleted projects)
			if (!fs.existsSync(entry.cwd)) continue;
			if (!fs.existsSync(entry.stateRoot) || !fs.existsSync(entry.manifestPath)) continue;
			if (fs.lstatSync(entry.stateRoot).isSymbolicLink()) continue;
			const cached = sharedScanCache.readAndCache("active-manifests", entry.runId, entry.manifestPath);
			const manifest = (cached?.raw ?? JSON.parse(fs.readFileSync(entry.manifestPath, "utf-8"))) as { status?: unknown };
			if (manifest.status !== "queued" && manifest.status !== "planning" && manifest.status !== "running" && manifest.status !== "blocked") continue;
			entries.push(entry);
		} catch {
			// Ignore stale entries; callers filter active status from manifests.
		}
	}
	return entries;
}`;

const newFn = `export function activeRunEntries(): ActiveRunRegistryEntry[] {
	const entries: ActiveRunRegistryEntry[] = [];
	for (const entry of readActiveRunRegistry()) {
		try {
			// Skip entries whose CWD no longer exists (temp test dirs, deleted projects)
			if (!fs.existsSync(entry.cwd)) continue;
			if (!fs.existsSync(entry.stateRoot) || !fs.existsSync(entry.manifestPath)) continue;
			if (fs.lstatSync(entry.stateRoot).isSymbolicLink()) continue;
			const cached = sharedScanCache.readAndCache("active-manifests", entry.runId, entry.manifestPath);
			const manifest = (cached?.raw ?? JSON.parse(fs.readFileSync(entry.manifestPath, "utf-8"))) as { status?: unknown; async?: { pid?: number } };
			if (manifest.status !== "queued" && manifest.status !== "planning" && manifest.status !== "running" && manifest.status !== "blocked") continue;
			// PID liveness check: async runs with dead PID are stale — don't surface them
			if (manifest.async?.pid) {
				try { process.kill(manifest.async.pid, 0); } catch { continue; }
			}
			entries.push(entry);
		} catch {
			// Ignore stale entries; callers filter active status from manifests.
		}
	}
	return entries;
}`;

if (!c.includes(oldFn)) {
    console.error('Cannot find activeRunEntries');
    process.exit(1);
}
c = c.replace(oldFn, newFn);
fs.writeFileSync('src/state/active-run-registry.ts', c);
console.log('Added PID liveness check to activeRunEntries');
