import { describe, expect, it } from "vitest";
import { parseBounds } from "../src/lib/mapStore";

describe("parseBounds", () => {
  it("reads the playable-area box from arena XML", () => expect(parseBounds("<root><boundingBox><bottomLeft>-500 -500</bottomLeft><upperRight>500.5 400</upperRight></boundingBox></root>")).toEqual({ x0: -500, z0: -500, x1: 500.5, z1: 400 }));
  it("rejects missing or inverted boxes", () => {
    expect(parseBounds("<root/>")).toBeNull(); expect(parseBounds("<bottomLeft>5 5</bottomLeft><upperRight>1 9</upperRight>")).toBeNull();
  });
});
