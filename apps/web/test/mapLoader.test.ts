import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapLoader } from "../src/features/player/MapLoader";

// Server rendering skips effects, so no IndexedDB is touched; the markup is.
// Regression: after saving heights the panel stayed open with no close control
// in reach — the only Cancel sat above the heights section.
describe("MapLoader heights section", () => {
  it("offers a Close button in the heights row", () => {
    const html = renderToString(createElement(MapLoader, { mapName: "101_dday", onSaved: () => {}, onClose: () => {} }));
    expect(html).toContain("Real heights");
    expect(html).toContain("Save heights");
    expect(html).toContain(">Close<");
  });
});

describe("MapLoader obstacles section", () => {
  it("shows the obstacles block with a .json file input and a Save button", () => {
    const html = renderToString(createElement(MapLoader, { mapName: "101_dday", onSaved: () => {}, onClose: () => {} }));
    expect(html).toContain("Obstacles");
    expect(html).toContain("Obstacles .json");
    expect(html).toContain("Save obstacles");
    expect(html).toContain("No obstacles saved");
  });
});
