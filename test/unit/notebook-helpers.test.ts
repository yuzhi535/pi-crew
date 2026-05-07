import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isNotebookPath,
  parseNotebook,
  getCell,
  updateCell,
  serializeNotebook,
} from "../../src/runtime/notebook-helpers.ts";

const validNotebook = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3" } },
  cells: [
    { cell_type: "markdown", source: "# Title", metadata: {} },
    { cell_type: "code", source: ["print('hi')\n", "x = 1"], outputs: [], metadata: {} },
  ],
});

describe("isNotebookPath", () => {
  it("matches .ipynb", () => assert.ok(isNotebookPath("foo.ipynb")));
  it("matches .IPYNB case-insensitive", () => assert.ok(isNotebookPath("FOO.IPYNB")));
  it("rejects .ts", () => assert.ok(!isNotebookPath("foo.ts")));
  it("rejects .py", () => assert.ok(!isNotebookPath("foo.py")));
});

describe("parseNotebook", () => {
  it("parses valid notebook", () => {
    const nb = parseNotebook(validNotebook);
    assert.equal(nb.nbformat, 4);
    assert.equal(nb.cells.length, 2);
    assert.equal(nb.cells[0].cellType, "markdown");
    assert.equal(nb.cells[0].source, "# Title");
  });

  it("joins array source with newline", () => {
    const nb = parseNotebook(validNotebook);
    assert.equal(nb.cells[1].source, "print('hi')\nx = 1");
  });

  it("returns empty cells for malformed JSON", () => {
    const nb = parseNotebook("not json{{{");
    assert.equal(nb.cells.length, 0);
  });

  it("handles empty cells array", () => {
    const nb = parseNotebook(JSON.stringify({ nbformat: 4, cells: [] }));
    assert.equal(nb.cells.length, 0);
  });
});

describe("getCell", () => {
  const nb = parseNotebook(validNotebook);
  it("returns cell for valid index", () => {
    assert.equal(getCell(nb, 0)?.source, "# Title");
  });
  it("returns undefined for invalid index", () => {
    assert.equal(getCell(nb, 99), undefined);
  });
});

describe("updateCell", () => {
  it("returns new notebook with updated source", () => {
    const nb = parseNotebook(validNotebook);
    const updated = updateCell(nb, 0, "## New");
    assert.equal(updated.cells[0].source, "## New");
    assert.equal(nb.cells[0].source, "# Title"); // original unchanged
  });
});

describe("serializeNotebook roundtrip", () => {
  it("parse → serialize → parse preserves content", () => {
    const nb1 = parseNotebook(validNotebook);
    const json = serializeNotebook(nb1);
    const nb2 = parseNotebook(json);
    assert.equal(nb2.cells.length, nb1.cells.length);
    assert.equal(nb2.cells[0].source, nb1.cells[0].source);
    assert.equal(nb2.cells[1].source, nb1.cells[1].source);
    assert.equal(nb2.nbformat, nb1.nbformat);
  });
});
