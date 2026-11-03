export const name = "@wotrep/gamedata";

/** Display names for vehicles. Real data (#42: Lesta/WG vehicle API, needs an application id) will replace `OVERRIDES`;
 *  until then a readable label is derived from the internal tag, e.g. `intunion:Un15_SBM_44` → "SBM 44". */
const OVERRIDES: Record<string, string> = { "germany:G51_Lowe": "Löwe" };

export interface VehicleLabel { nation: string; label: string; tag: string }

export function vehicleLabel(vehicleType: string): VehicleLabel {
  const [nation = "", tag = vehicleType] = vehicleType.includes(":") ? vehicleType.split(":") : ["", vehicleType];
  const override = OVERRIDES[vehicleType];
  const label = override ?? (tag.replace(/^[A-Za-z]{1,3}\d+_/, "").replace(/_/g, " ").trim() || tag || vehicleType || "?");
  return { nation, label, tag };
}
