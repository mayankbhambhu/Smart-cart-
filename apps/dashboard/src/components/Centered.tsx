import type { ReactNode } from "react";

/** A single card in the middle of the page: sign-in and other full-page messages. */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}
