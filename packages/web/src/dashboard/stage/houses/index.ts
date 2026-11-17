import type { StageDraft } from "../draft";
import { fillCottage, type CottageVariant } from "./cottage";
import { fillWorkshop } from "./workshop";

export type HouseId = "cottage" | "workshop";

export function fillHouse(id: HouseId, d: StageDraft, variant: CottageVariant = "violet") {
  if (id === "cottage") fillCottage(d, variant);
  if (id === "workshop") fillWorkshop(d);
}
