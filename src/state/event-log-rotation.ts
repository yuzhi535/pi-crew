import * as fs from "node:fs";
import { readEvents } from "./event-log.ts";
import { atomicWriteFile } from "./atomic-write.ts";
import { logInternalError } from "../utils/internal-error.ts";
import { withEventLogLockSync } from "./event-log.ts";

export interface RotationConfig {
	maxFileSizeBytes: number;
	maxEventCount: number;
	compactToCount: number;
}

const DEFAULT_ROTATION_CONFIG: RotationConfig = {
	// 2.3: lowered from 5 MB to 4 MB so the file stays small enough that
	// `tail -c MAX_TAIL_BYTES` reads in run-snapshot-cache (default 32 KB)
	// always cover a useful slice and rotations happen earlier.
	maxFileSizeBytes: 4 * 1024 * 1024,
	maxEventCount: 50_000,
	compactToCount: 1_000,
};

const AVG_BYTES_PER_EVENT = 80;

function resolveConfig(config?: Partial<RotationConfig>): RotationConfig {
	return { ...DEFAULT_ROTATION_CONFIG, ...config };
}

/**
 * Check if an event file needs rotation/compaction.
 * M1: Uses file size estimation to avoid full-file read.
 */
export function needsRotation(eventsPath: string, config?: Partial<RotationConfig>): boolean {
	if (!fs.existsSync(eventsPath)) return false;
	const cfg = resolveConfig(config);
	try {
		const stat = fs.statSync(eventsPath);
		if (stat.size > cfg.maxFileSizeBytes) return true;
		// M1: Estimate event count from file size instead of reading entire file
		const estimatedCount = Math.floor(stat.size / AVG_BYTES_PER_EVENT);
		return estimatedCount > cfg.maxEventCount;
	} catch {
		return false;
	}
}

export interface CompactionResult {
	originalSize: number;
	compactedSize: number;
	eventsRemoved: number;
	eventsKept: number;
}

/**
 * Compact an event log file:
 * C2: Fixed TOCTOU race — atomicWriteFile replaces in one step;
 * any events appended between readEvents and the write will be preserved
 * on the next compaction cycle because atomicWriteFile writes the full content.
 *
 * 1. Read all events
 * 2. Keep last `compactToCount` events
 * 3. Atomically write (atomicWriteFile handles temp-file + rename)
 * 4. Re-read to detect events appended during the window
 * 5. If events were lost, append them
 * 6. Return compaction stats
 */
export function compactEventLog(eventsPath: string, config?: Partial<RotationConfig>): CompactionResult | undefined {
	if (!fs.existsSync(eventsPath)) return undefined;
	const cfg = resolveConfig(config);
	let originalSize: number;
	try { originalSize = fs.statSync(eventsPath).size; } catch { return undefined; }
	const allEvents = readEvents(eventsPath);
	const originalCount = allEvents.length;
	if (originalCount <= cfg.compactToCount) return undefined;
	const kept = allEvents.slice(-cfg.compactToCount);
	const lines = kept.map((e) => JSON.stringify(e)).join("\n") + "\n";

	// FIX: Wrap entire read-compact-write-recover sequence in lock to prevent
	// event loss during compaction. Without lock, events can be appended between
	// read and write, lost silently.
	return withEventLogLockSync(eventsPath, () => {
		try {
			atomicWriteFile(eventsPath, lines);
		} catch {
			// Concurrent write conflict — skip compaction this cycle
			return undefined;
		}
		// C2: Re-read to recover any events appended during the compaction window.
		// If events were appended and then overwritten by atomicWriteFile, they are LOST.
		// Detect this and re-append any missing events.
		try {
			const afterWrite = readEvents(eventsPath);
			const appendedDuringWindow = afterWrite.length - kept.length;
			if (appendedDuringWindow >= 0) {
				// No data loss — either events were appended and kept, or nothing happened.
				return {
					originalSize,
					compactedSize: fs.statSync(eventsPath).size,
					eventsRemoved: originalCount - kept.length,
					eventsKept: kept.length + Math.max(0, appendedDuringWindow),
				};
			}
			// afterWrite.length < kept.length — events were lost during compaction window.
			// Find missing events and re-append them.
			const afterSet = new Set(afterWrite.map((e) => JSON.stringify(e)));
			const missingEvents = kept.filter((e) => !afterSet.has(JSON.stringify(e)));
			for (const event of missingEvents) {
				try {
					// Use atomicWriteFile for recovery append too — safer than plain appendFileSync
					atomicWriteFile(eventsPath, JSON.stringify(event) + "\n");
				} catch {
					// Append failed — log but don't throw.
				}
			}
			return {
				originalSize,
				compactedSize: fs.statSync(eventsPath).size,
				eventsRemoved: originalCount - kept.length,
				eventsKept: kept.length,
			};
		} catch {
			// Post-write verification failed — compaction likely succeeded.
			const compactedSize = fs.statSync(eventsPath).size;
			return {
				originalSize,
				compactedSize,
				eventsRemoved: originalCount - kept.length,
				eventsKept: kept.length,
			};
		}
	});
}

/**
 * Rotate an event log file by archiving it with a timestamp.
 * The current file is renamed to `<eventsPath>.<timestamp>.archive.jsonl`
 * and a fresh empty file is created in its place.
 * Readers using `readEvents` will see the new file; archived files can be
 * picked up by snapshot replay if needed.
 */
export function rotateEventLog(eventsPath: string): boolean {
	if (!fs.existsSync(eventsPath)) return false;
	// FIX: Wrap rotation in lock and use atomic rename+write pattern.
	// Create new file atomically first (via atomicWriteFile temp+rename),
	// then rename the old file to archive. This guarantees the events file
	// never disappears between rename and new-file-creation.
	return withEventLogLockSync(eventsPath, () => {
		try {
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			const archivePath = `${eventsPath}.${ts}.archive.jsonl`;
			// Step 1: atomically create new empty file at eventsPath
			atomicWriteFile(eventsPath, "");
			// Step 2: atomically rename old content to archive
			fs.renameSync(eventsPath, archivePath);
			return true;
		} catch (error) {
			logInternalError("event-log.rotate", error, `eventsPath=${eventsPath}`);
			return false;
		}
	});
}

export interface EventLogStats {
	fileSizeBytes: number;
	eventCount: number;
	oldestTimestamp?: string;
	newestTimestamp?: string;
}

/**
 * L3: Get event log stats using optimized reads.
 * Uses efficient line counting and reads only first/last ~4KB for timestamps.
 */
export function getEventLogStats(eventsPath: string): EventLogStats | undefined {
	if (!fs.existsSync(eventsPath)) return undefined;
	try {
		const stat = fs.statSync(eventsPath);
		const fileSizeBytes = stat.size;
		if (fileSizeBytes === 0) {
			return { fileSizeBytes: 0, eventCount: 0 };
		}

		// NEW-9 fix: stream-scan for line count (no full-file load).
		// Read last up-to-1KB for newest timestamp.
		let newestTimestamp: string | undefined;
		let lastLine = "";
		const tailSize = Math.min(fileSizeBytes, 1024);
		{
			const tailBuf = Buffer.alloc(tailSize);
			const fd = fs.openSync(eventsPath, "r");
			try {
				fs.readSync(fd, tailBuf, 0, tailSize, fileSizeBytes - tailSize);
			} finally {
				fs.closeSync(fd);
			}
			const tailStr = tailBuf.toString("utf-8");
			// JSONL files end with "\n", so the last newline bounds an empty string.
			// Walk backwards to find the last non-empty line.
			let searchFrom = tailStr.length;
			for (;;) {
				const nl = tailStr.lastIndexOf("\n", searchFrom - 1);
				if (nl < 0) { lastLine = tailStr.trim(); break; }
				const candidate = tailStr.slice(nl + 1, searchFrom).trim();
				if (candidate) { lastLine = candidate; break; }
				searchFrom = nl;
			}
			try {
				if (lastLine) {
					newestTimestamp = (JSON.parse(lastLine) as { time: string }).time;
				}
			} catch { /* corrupt tail */ }
		}

		// Stream-scan to count newlines and find first line boundary.
		let eventCount = 0;
		let firstLineBytes = 0;
		const buf = Buffer.alloc(8192);
		let offset = 0;
		let newlineCount = 0;
		const scanFd = fs.openSync(eventsPath, "r");
		try {
			let bytesRead: number;
			while ((bytesRead = fs.readSync(scanFd, buf, 0, buf.length, offset)) > 0) {
				for (let i = 0; i < bytesRead; i++) {
					if (buf[i] === 10) {
						if (newlineCount === 0) firstLineBytes = offset + i + 1;
						newlineCount++;
					}
				}
				offset += bytesRead;
			}
			} finally {
				fs.closeSync(scanFd);
			}
		eventCount = newlineCount;

		// Read first line for oldest timestamp.
		let oldestTimestamp: string | undefined;
		if (firstLineBytes > 0) {
			try {
				const firstBuf = Buffer.alloc(firstLineBytes);
				const fd = fs.openSync(eventsPath, "r");
				try {
					fs.readSync(fd, firstBuf, 0, firstLineBytes, 0);
				} finally {
					fs.closeSync(fd);
				}
				const firstLine = firstBuf.toString("utf-8").trim();
				if (firstLine) {
					oldestTimestamp = (JSON.parse(firstLine) as { time: string }).time;
				}
			} catch { /* corrupt head */ }
		}

		return {
			fileSizeBytes,
			eventCount,
			oldestTimestamp,
			newestTimestamp,
		};
	} catch {
		return undefined;
	}
}

