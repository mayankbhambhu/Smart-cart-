"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Centered } from "@/components/Centered";
import { DEMO } from "@/lib/api";
import { useSession } from "@/lib/session";
import { passwordMessage, signInMessage } from "@/lib/team";

type DemoLogin = { login: string; password: string; name: string; label: string };

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";
const primary = "w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";

/** Store-team sign-in: staff ID or registered phone, plus password. Shoppers use the app. */
export function SignIn() {
  const { signIn } = useSession();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoLogins, setDemoLogins] = useState<readonly DemoLogin[]>([]);

  useEffect(() => {
    if (DEMO) void import("@smart-cart/demo").then((m) => setDemoLogins(m.DEMO_LOGINS.filter((l) => l.role !== "floor_staff")));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(login, password);
    } catch (err) {
      setError(signInMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <div>
        <p className="text-lg font-semibold text-brand">Smart Cart</p>
        <h1 className="text-xl font-semibold">Store team sign-in</h1>
        <p className="text-sm text-slate-500">For store managers and the SmartCart admin team. Shoppers use the app.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Staff ID or registered phone</span>
          <input className={input} value={login} onChange={(e) => setLogin(e.target.value)} placeholder="S01-0042 or 98765 43210" autoComplete="username" required />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Password</span>
          <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
        <button className={primary} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="text-xs text-slate-500">
        No account? Your store manager requests one and the SmartCart admin team approves it. Your staff ID and a temporary
        password arrive by SMS.
      </p>
      {demoLogins.length > 0 && (
        <div className="space-y-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900">
          <p className="font-medium">Demo accounts</p>
          {demoLogins.map((d) => (
            <button
              key={d.login}
              type="button"
              onClick={() => {
                setLogin(d.login);
                setPassword(d.password);
              }}
              className="flex w-full items-center justify-between rounded border border-sky-200 bg-white px-2 py-1 text-left hover:bg-sky-100"
            >
              <span>
                {d.label} · {d.name}
              </span>
              <span className="font-mono text-xs">{d.login}</span>
            </button>
          ))}
          <p className="text-xs">Floor staff (S01-0002 / floor-demo-1) sign in on the shopper app's Store team tab.</p>
        </div>
      )}
    </Centered>
  );
}

/** First sign-in after approval or a resend: the temporary password must be replaced. */
export function ChangePassword() {
  const { session, changePassword, signOut } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) return setError("The two new passwords don't match.");
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (/^\d+$/.test(next)) return setError("Use letters as well as numbers.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(passwordMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <div>
        <h1 className="text-xl font-semibold">Set your own password</h1>
        <p className="text-sm text-slate-500">
          Welcome, {session?.name}. Replace the temporary password from the SMS before you continue.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Temporary password</span>
          <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">New password</span>
          <input className={input} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          <span className="text-xs text-slate-500">At least 8 characters, not only numbers.</span>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">New password again</span>
          <input className={input} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
        <button className={primary} disabled={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </button>
      </form>
      <button onClick={signOut} className="text-sm text-slate-500 underline">
        Sign out
      </button>
    </Centered>
  );
}
