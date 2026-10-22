import { ShopperDemo } from "@smart-cart/demo";

let backend: ShopperDemo | null = null;
/** The in-app simulated store for demo builds, created on first use. */
export const demo = () => (backend ??= new ShopperDemo());
