import { test, describe } from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { AtomicWriter } from "../../src/state/atomic-write-v2.ts";

describe("AtomicWriter", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-test-"));
  const writer = new AtomicWriter(tmpDir);

  test.afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      const p = path.join(tmpDir, f);
      fs.rmSync(p, { recursive: true, force: true });
    }
  });

  test("writes file atomically (file exists after write)", () => {
    const target = path.join(tmpDir, "test.json");
    writer.writeJsonSync(target, { foo: "bar" });
    assert.ok(fs.existsSync(target));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8")), { foo: "bar" });
  });

  test("overwrites existing file atomically", () => {
    const target = path.join(tmpDir, "existing.json");
    fs.writeFileSync(target, '{"old": true}', "utf8");
    writer.writeJsonSync(target, { new: true });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8")), { new: true });
  });

  test("writes .gitignore to directory on first use", () => {
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir);
    const target = path.join(subDir, "data.json");
    writer.writeJsonSync(target, {});
    const gitignore = path.join(subDir, ".gitignore");
    assert.ok(fs.existsSync(gitignore));
    assert.strictEqual(fs.readFileSync(gitignore, "utf8"), "*\n");
  });

  test("async write works", async () => {
    const target = path.join(tmpDir, "async.json");
    await writer.writeJsonAsync(target, { async: true });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, "utf8")), { async: true });
  });

  test("uses UUID in tmp file name", () => {
    const target = path.join(tmpDir, "uuid-test.json");
    writer.writeJsonSync(target, { x: 1 });
    assert.ok(fs.existsSync(target));
  });
});