"use client";

import { DEMO } from "@/lib/api";

// The app demo is built next to the dashboard (out/app/), so it is one folder up from this page.
const APP_URL = "../app/";

const steps = [
  "Sign in with any name, then tap Start shopping and pick a cart.",
  "Scan a few items from the demo shelf. The cart appears under Active carts here, and stock moves in Inventory.",
  "Try Find, Smart list and Ask: they answer from this store's catalogue and stock.",
  "Tap Call for help. The request shows up under Help here; press “I'm on my way” and the phone updates.",
  "Check out and pay. The order and its exit code appear under Orders, ready for the door check.",
];

/** The shopper's phone app beside the staff dashboard, so one person can demo both sides. */
export default function ShopperPage() {
  if (!DEMO)
    return (
      <section className="max-w-xl space-y-2">
        <h1 className="text-xl font-semibold">Shopper app</h1>
        <p className="text-sm text-slate-600">
          Shoppers use the Smart Cart app on their phone. To try it, run <code>pnpm --filter mobile start</code> and open it
          in Expo Go, or open the web demo on GitHub Pages.
        </p>
      </section>
    );

  return (
    <section className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="mx-auto shrink-0 rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 shadow-xl">
        <iframe
          src={APP_URL}
          title="Smart Cart shopper app"
          className="block h-[720px] w-[360px] max-w-[calc(100vw-56px)] rounded-[1.8rem] bg-white"
        />
      </div>
      <div className="min-w-0 max-w-xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Shopper app</h1>
          <p className="text-sm text-slate-500">
            The app a shopper uses in the store, running on a simulated store in your browser. What they do here shows up live
            on the dashboard tabs above.
          </p>
        </div>
        <ol className="space-y-2 text-sm text-slate-700">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-slate-500">
          On a phone,{" "}
          <a href={APP_URL} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
            open the app full screen
          </a>
          . Add it to your home screen to use it like an installed app.
        </p>
      </div>
    </section>
  );
}
