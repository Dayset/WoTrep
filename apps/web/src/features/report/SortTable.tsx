import { useMemo, useState, type ReactNode } from "react";

/** Sortable data table: click a header to sort, click again to flip. Missing values (null) always sort last. */
export interface SortCol { key: string; label: ReactNode; title?: string }
export interface SortCell { v: number | string | null; node: ReactNode }
export interface SortRow { id: string | number; cls?: string; cells: Record<string, SortCell> }

export function SortTable({ cols, rows, sortKey, dir = -1, wrapClass, testId }: { cols: SortCol[]; rows: SortRow[]; sortKey: string; dir?: 1 | -1; wrapClass?: string; testId?: string }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: sortKey, dir });
  const sorted = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const x = a.cells[sort.k]?.v ?? null, y = b.cells[sort.k]?.v ?? null;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return c * sort.dir;
    });
    return out;
  }, [rows, sort]);
  return (
    <div className={`tablewrap ${wrapClass ?? ""}`.trim()} data-testid={testId}>
      <table>
        <thead>
          <tr>{cols.map((c) => (
            <th key={c.key} title={c.title} aria-sort={sort.k === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
              <button type="button" className="sortbtn" onClick={() => setSort((s) => (s.k === c.key ? { k: c.key, dir: (-s.dir) as 1 | -1 } : { k: c.key, dir: -1 }))}>
                {c.label}{sort.k === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </button>
            </th>))}</tr>
        </thead>
        <tbody>{sorted.map((r) => (
          <tr key={r.id} className={r.cls}>{cols.map((c) => <td key={c.key}>{r.cells[c.key]?.node ?? "—"}</td>)}</tr>))}</tbody>
      </table>
    </div>
  );
}
