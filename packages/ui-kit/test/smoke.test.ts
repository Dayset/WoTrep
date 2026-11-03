import { it, expect } from "vitest";
import { name } from "../src/index";
it("loads", () => expect(name).toBe("@wotrep/ui-kit"));
