export interface NotebookCell {
  index: number;
  cellType: "code" | "markdown" | "raw";
  source: string;
  outputs?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat: number;
}

/** Check if a file path is a notebook */
export function isNotebookPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".ipynb");
}

function normalizeSource(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) return source.join("");
  return "";
}

/** Parse a .ipynb JSON file into a Notebook structure */
export function parseNotebook(content: string): Notebook {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { cells: [], nbformat: 4 };
  }
  if (typeof raw !== "object" || raw === null) return { cells: [], nbformat: 4 };
  const obj = raw as Record<string, unknown>;
  const nbformat = typeof obj.nbformat === "number" ? obj.nbformat : 4;
  const rawCells = Array.isArray(obj.cells) ? obj.cells : [];
  const cells: NotebookCell[] = rawCells
    .map((c: unknown, i: number): NotebookCell | null => {
      if (typeof c !== "object" || c === null) return null;
      const cell = c as Record<string, unknown>;
      const cellType = cell.cell_type;
      if (cellType !== "code" && cellType !== "markdown" && cellType !== "raw") return null;
      return {
        index: i,
        cellType,
        source: normalizeSource(cell.source),
        outputs: Array.isArray(cell.outputs) ? cell.outputs : undefined,
        metadata:
          cell.metadata && typeof cell.metadata === "object" && !Array.isArray(cell.metadata)
            ? (cell.metadata as Record<string, unknown>)
            : undefined,
      };
    })
    .filter((c: NotebookCell | null): c is NotebookCell => c !== null);
  const metadata =
    obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata)
      ? (obj.metadata as Record<string, unknown>)
      : undefined;
  return { cells, metadata, nbformat };
}

/** Get a specific cell by index */
export function getCell(notebook: Notebook, index: number): NotebookCell | undefined {
  return notebook.cells.find((c) => c.index === index);
}

/** Update a cell's source content, returning a new Notebook */
export function updateCell(notebook: Notebook, index: number, source: string): Notebook {
  const cells = notebook.cells.map((c) =>
    c.index === index ? { ...c, source } : c,
  );
  return { ...notebook, cells };
}

/** Serialize a Notebook back to .ipynb JSON string */
export function serializeNotebook(notebook: Notebook): string {
  const raw = {
    nbformat: notebook.nbformat,
    nbformat_minor: 5,
    metadata: notebook.metadata ?? {},
    cells: notebook.cells.map((c) => ({
      cell_type: c.cellType,
      source: c.source,
      metadata: c.metadata ?? {},
      ...(c.cellType === "code" ? { outputs: c.outputs ?? [], execution_count: null } : {}),
    })),
  };
  return JSON.stringify(raw, null, 2) + "\n";
}
