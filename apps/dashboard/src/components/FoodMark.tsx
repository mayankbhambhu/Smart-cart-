import type { FoodType } from "@smart-cart/contracts";

export const foodTypeLabel: Record<FoodType, string> = { veg: "Veg", non_veg: "Non-veg", egg: "Egg", not_food: "Not food" };

/**
 * The pack's FSSAI mark: a green dot in a square for veg, brown for non-veg (egg products carry the
 * brown mark too, so they also say "egg"). Products nobody has labelled say so; never guess one.
 */
export function FoodMark({ type }: { type: FoodType | null }) {
  if (type === null) return <span className="text-xs italic text-slate-400">Not labelled</span>;
  if (type === "not_food") return <span className="text-xs text-slate-500">Not food</span>;
  const color = type === "veg" ? "#15803D" : "#7C2D12";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border-[1.5px]" style={{ borderColor: color }} aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      </span>
      {foodTypeLabel[type]}
    </span>
  );
}
