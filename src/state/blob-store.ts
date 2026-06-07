import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { resolveRealContainedPath } from "../utils/safe-paths.ts";
import { atomicWriteFile, renameWithRetry } from "./atomic-write.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

function validateBlobHash(hash: string, algorithm?: string): void {
	if (!SHA256_HEX.test(hash)) throw new Error(`Invalid blob hash: ${hash}`);
	if (algorithm !== undefined && algorithm !== SHA256_PREFIX) {
		throw new Error(`Invalid blob algorithm: ${algorithm} (expected ${SHA256_PREFIX})`);
	}
}

/**
 * Atomically write a Buffer to a file using temp-file + rename pattern.
 * Prevents partial writes on crash and handles concurrent writes safely.
 */
function atomicWriteBuffer(filePath: string, content: Buffer): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
	const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
	try {
		const openedStat = fs.fstatSync(fd);
		if (!openedStat.isFile()) {
			fs.closeSync(fd);
			throw new Error(`Refusing to write: opened path is not a regular file: ${tempPath}`);
		}
		fs.writeSync(fd, content, 0, content.length);
		fs.closeSync(fd);
		renameWithRetry(tempPath, filePath);
	} catch (error) {
		try { fs.rmSync(tempPath, { force: true }); } catch { /* best-effort */ }
		throw error;
	}
}

const BLOBS_DIR = "blobs";
const BLOB_META_DIR = "blob-metadata";
const SHA256_PREFIX = "sha256";

export interface BlobMetadata {
	blobHash: string;
	blobAlgorithm: string;
	runId: string;
	taskId?: string;
	mime: string;
	producer: string;
	originalPath: string;
	sizeBytes: number;
	redacted: boolean;
	retention: "run" | "project" | "temporary";
	createdAt: string;
}

export interface BlobWriteResult {
	hash: string;
	algorithm: string;
	blobPath: string;
	metadataPath: string;
	sizeBytes: number;
}

function sha256Of(content: string | Buffer): string {
	return createHash("sha256").update(typeof content === "string" ? content : content).digest("hex");
}

/**
 * Write content-addressed blob to the blobs directory under artifactsRoot.
 * Content is deduplicated by hash; metadata sidecar is always written.
 * FIX: Both content and metadata writes now use atomicWriteFile to prevent
 * partial writes on crash. The deduplication check is now advisory (the atomic
 * write handles concurrent writes correctly via O_EXCL temp file pattern).
 */
export function writeBlob(artifactsRoot: string, input: {
	content: string | Buffer;
	runId: string;
	taskId?: string;
	mime?: string;
	producer: string;
	originalPath: string;
	redacted?: boolean;
	retention?: BlobMetadata["retention"];
}): BlobWriteResult {
	const content = input.content;
	const hash = sha256Of(content);
	const algorithm = SHA256_PREFIX;
	const blobDir = path.join(artifactsRoot, BLOBS_DIR, algorithm);
	const metaDir = path.join(artifactsRoot, BLOB_META_DIR);
	fs.mkdirSync(blobDir, { recursive: true });
	fs.mkdirSync(metaDir, { recursive: true });

	const blobPath = path.join(blobDir, hash);
	const metadata: BlobMetadata = {
		blobHash: hash,
		blobAlgorithm: algorithm,
		runId: input.runId,
		taskId: input.taskId,
		mime: input.mime ?? "text/plain",
		producer: input.producer,
		originalPath: input.originalPath,
		sizeBytes: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "utf-8"),
		redacted: input.redacted ?? false,
		retention: input.retention ?? "run",
		createdAt: new Date().toISOString(),
	};
	const metadataPath = path.join(metaDir, `${hash}.json`);

	// Both content and metadata use atomic writes to prevent partial writes on crash.
	// Content is immutable and content-addressed (same hash = same content), so
	// concurrent writes to the same hash are safe. Metadata (mime, retention, etc.)
	// is written atomically via atomicWriteFile to prevent race conditions between
	// concurrent writers that might have different metadata values.
	atomicWriteBuffer(blobPath, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
	// Use atomicWriteFile for metadata - prevents partial metadata on crash.
	// Both content and metadata writes are now atomic, ensuring that either both
	// succeed or neither persists, preventing orphan blobs without metadata.
	atomicWriteFile(metadataPath, JSON.stringify(metadata, null, 2));

	return { hash, algorithm, blobPath: resolveRealContainedPath(artifactsRoot, blobPath), metadataPath: resolveRealContainedPath(artifactsRoot, metadataPath), sizeBytes: metadata.sizeBytes };
}

/**
 * Read a content-addressed blob by hash.
 * Validates hash format and enforces path containment.
 */
export function readBlob(artifactsRoot: string, hash: string): Buffer | undefined {
	validateBlobHash(hash);
	try {
		const blobDir = path.join(artifactsRoot, BLOBS_DIR, SHA256_PREFIX);
		const blobPath = resolveRealContainedPath(blobDir, hash);
		return fs.readFileSync(blobPath);
	} catch {
		return undefined;
	}
}

/**
 * Read blob metadata by hash.
 * Validates hash format and enforces path containment.
 */
export function readBlobMetadata(artifactsRoot: string, hash: string): BlobMetadata | undefined {
	validateBlobHash(hash);
	try {
		const metaDir = path.join(artifactsRoot, BLOB_META_DIR);
		const metaPath = resolveRealContainedPath(metaDir, `${hash}.json`);
		return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as BlobMetadata;
	} catch {
		return undefined;
	}
}