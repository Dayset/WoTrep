import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import ru from "../src/i18n/ru.json";

const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("i18n", () => {
  it("en and ru have exactly the same keys", () => {
    const a = Object.keys(en).sort(), b = Object.keys(ru).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]); expect(b.filter((k) => !a.includes(k))).toEqual([]);
  });
  it("every literal t('key') used in src exists in en.json", () => {
    const miss: string[] = [];
    for (const f of files(new URL("../src", import.meta.url).pathname)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([a-z0-9_.]+)"/g)) if (!(m[1]! in en)) miss.push(`${f}: ${m[1]}`);
    }
    expect(miss).toEqual([]);
  });
});

import { METRIC_KEYS } from "../src/features/report/glossary";
describe("glossary", () => {
  it("every shown metric explains how we get it and what it means, in en and ru", () => {
    for (const k of METRIC_KEYS) for (const part of ["how", "mean"]) for (const d of [en, ru] as Record<string, string>[]) expect((d[`gl.${k}.${part}`] ?? "").length, `${k}.${part}`).toBeGreaterThan(30);
  });
});
