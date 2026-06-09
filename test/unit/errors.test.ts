import test from "node:test";
import assert from "node:assert/strict";
import { CrewError, ErrorCode, errors } from "../../src/errors.ts";

test("CrewError formats with error code", () => {
  const err = new CrewError(ErrorCode.TaskNotFound, "Task 'xyz' not found");
  assert.match(err.toString(), /^error\[E003\]: Task 'xyz' not found/);
});

test("CrewError formats with context", () => {
  const err = new CrewError(ErrorCode.FileReadError, "Failed to read manifest.json")
    .withContext("while loading run state");
  const str = err.toString();
  assert.match(str, /error\[E001\]:/);
  assert.match(str, /context: while loading run state/);
});

test("CrewError formats with help", () => {
  const err = new CrewError(ErrorCode.ConfigError, "parse failure")
    .withHelp("Try running `team init`");
  const str = err.toString();
  assert.match(str, /help: Try running `team init`/);
});

test("CrewError has default help for E001-E006", () => {
  assert.ok(errors.fileRead("x.txt", { code: "ENOENT" } as NodeJS.ErrnoException).help);
  assert.ok(errors.taskNotFound("t1").help);
  assert.ok(errors.config("bad").help);
});

test("CrewError is instanceof Error", () => {
  assert.ok(new CrewError(ErrorCode.FileWriteError, "x") instanceof Error);
});

test("withHelp overrides default help", () => {
  const err = errors.fileRead("x", { code: "ENOENT" } as NodeJS.ErrnoException)
    .withHelp("custom help override");
  assert.equal(err.help, "custom help override");
});

test("CrewError factory methods produce correct codes", () => {
  assert.equal(errors.fileRead("x", {} as NodeJS.ErrnoException).code, ErrorCode.FileReadError);
  assert.equal(errors.taskNotFound("t1").code, ErrorCode.TaskNotFound);
  assert.equal(errors.invalidStatusTransition("running", "queued").code, ErrorCode.InvalidStatusTransition);
  assert.equal(errors.resourceNotFound("agent", "my-agent").code, ErrorCode.ResourceNotFound);
});