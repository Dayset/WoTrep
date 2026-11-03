import { describe, expect, it } from "vitest";
import { vehicleLabel } from "../src/index";

describe("vehicleLabel", () => {
  it.each([
    ["intunion:Un15_SBM_44", "SBM 44"], ["ussr:R40_T-54", "T-54"], ["uk:GB110_FV4201_Chieftain_Prototype_B", "FV4201 Chieftain Prototype B"],
    ["germany:G51_Lowe", "Löwe"], ["italy:It19_Progetto_C50_mod_66", "Progetto C50 mod 66"],
  ])("%s → %s", (tag, label) => expect(vehicleLabel(tag).label).toBe(label));
  it("never returns an empty label, even for odd input", () => {
    for (const x of ["", "x", "nation:", "a:b:c", "ussr:R1_"]) expect(vehicleLabel(x).label.length).toBeGreaterThan(0);
  });
});
