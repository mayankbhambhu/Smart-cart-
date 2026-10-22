"use client";

import type { SmsReceipt, StaffAccount, StaffCreateRequest, StaffRequest } from "@smart-cart/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, buttonCls, Card, inputCls, Loading, Notice, PageHead, primaryCls, type Tone } from "@/components/ui";
import { apiPost, apiPut, STORE_ID } from "@/lib/api";
import { staffQuery, storeRequestsQuery } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { dateTime, phoneLabel, requestMessage, requestStatus, roleLabel, smsText } from "@/lib/team";

const accountTone: Record<StaffAccount["status"], Tone> = { active: "green", suspended: "amber", deactivated: "grey" };
const accountLabel: Record<StaffAccount["status"], string> = {
  active: "Active",
  suspended: "Suspended, waiting for approval",
  deactivated: "Switched off",
};

type Message = { tone: "ok" | "error" | "info"; text: string };

/**
 * The store's accounts. Managers can't create or switch off an account themselves: they raise a
 * request, and the SmartCart admin team approves it. Switching off suspends the account at once.
 */
export default function StaffPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const staff = useQuery(staffQuery());
  const requests = useQuery(storeRequestsQuery());
  const [message, setMessage] = useState<Message | null>(null);
  const [offFor, setOffFor] = useState<StaffAccount | null>(null);
  const [editing, setEditing] = useState<StaffRequest | null>(null);
  const [sent, setSent] = useState(0);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["staff", STORE_ID] });
    void queryClient.invalidateQueries({ queryKey: ["staffRequests"] });
  };

  const resend = useMutation({
    mutationFn: (a: StaffAccount) => apiPost<{ sms: SmsReceipt }>(`/admin/v1/stores/${STORE_ID}/staff/${a.id}/resend-password`, {}),
    onSuccess: (res, a) => setMessage({ tone: "ok", text: smsText(`New temporary password sent to ${a.name}`, res.sms) }),
    onError: (e) => setMessage({ tone: "error", text: requestMessage(e) }),
    onSettled: refresh,
  });

  return (
    <section className="space-y-5">
      <PageHead
        title="Staff accounts"
        hint="New accounts and switching one off both need the SmartCart admin team's approval. Every step is kept in the audit log."
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Staff ID</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Shift</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!staff.data && (
              <tr>
                <td colSpan={7} className="px-3 py-4">
                  <Loading error={staff.error} />
                </td>
              </tr>
            )}
            {staff.data?.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{a.name}</td>
                <td className="px-3 py-2 font-mono">{a.staffCode}</td>
                <td className="px-3 py-2">{roleLabel[a.role]}</td>
                <td className="whitespace-nowrap px-3 py-2">{phoneLabel(a.phone)}</td>
                <td className="px-3 py-2">{a.shift ?? "—"}</td>
                <td className="px-3 py-2">
                  <Badge tone={accountTone[a.status]}>{accountLabel[a.status]}</Badge>
                  {a.status === "active" && a.mustChangePassword && (
                    <span className="mt-0.5 block text-xs text-slate-500">Hasn't set a password yet</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {a.status === "active" && a.mustChangePassword && (
                    <button className={buttonCls} disabled={resend.isPending} onClick={() => resend.mutate(a)}>
                      Resend password
                    </button>
                  )}{" "}
                  {a.status === "active" && a.staffCode !== session?.staffCode && (
                    <button className={`${buttonCls} text-red-700`} onClick={() => setOffFor(a)}>
                      Switch off
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {offFor && (
        <SwitchOff
          account={offFor}
          onDone={(m) => {
            setOffFor(null);
            if (m) setMessage(m);
            refresh();
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <RequestForm
          key={editing?.id ?? `new-${sent}`}
          editing={editing}
          onDone={(m) => {
            setEditing(null);
            setSent((n) => n + 1);
            setMessage(m);
            refresh();
          }}
          onCancel={() => setEditing(null)}
        />
        <Card title="Requests from this store">
          {!requests.data ? (
            <Loading error={requests.error} />
          ) : requests.data.length === 0 ? (
            <p className="text-sm text-slate-500">No requests yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.data.map((r) => (
                <li key={r.id} className="space-y-1 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.type === "create" ? "New account" : "Switch off"}: {r.fullName}
                      <span className="font-normal text-slate-500"> · {roleLabel[r.role]}</span>
                    </span>
                    <Badge tone={requestStatus[r.status].tone}>{requestStatus[r.status].label}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    Raised by {r.requestedBy ?? "a manager"} · {dateTime(r.createdAt)}
                    {r.reason && ` · Reason: ${r.reason}`}
                  </p>
                  {r.reviewNote && (
                    <p className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                      {r.reviewedBy ?? "Admin team"}: {r.reviewNote}
                    </p>
                  )}
                  {r.status === "changes_requested" && r.type === "create" && (
                    <button className={buttonCls} onClick={() => setEditing(r)}>
                      Fix and resubmit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

function RequestForm({ editing, onDone, onCancel }: { editing: StaffRequest | null; onDone: (m: Message) => void; onCancel: () => void }) {
  const [form, setForm] = useState<StaffCreateRequest>({
    fullName: editing?.fullName ?? "",
    phone: editing?.phone ?? "",
    role: editing?.role === "manager" ? "manager" : "floor_staff",
    shift: editing?.shift ?? "",
    employeeRef: editing?.employeeRef ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof StaffCreateRequest) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const send = useMutation({
    mutationFn: (body: StaffCreateRequest) =>
      editing
        ? apiPut<StaffRequest>(`/admin/v1/stores/${STORE_ID}/staff-requests/${editing.id}`, body)
        : apiPost<StaffRequest>(`/admin/v1/stores/${STORE_ID}/staff-requests`, body),
    onSuccess: (r) =>
      onDone({ tone: "ok", text: `Request for ${r.fullName} sent to the SmartCart admin team. Their staff ID and password arrive by SMS once approved.` }),
    onError: (e) => setError(requestMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    send.mutate({ ...form, shift: form.shift?.trim() || null, employeeRef: form.employeeRef?.trim() || null });
  };

  return (
    <Card
      title={editing ? `Fix and resubmit: ${editing.fullName}` : "Request a new account"}
      hint={editing ? (editing.reviewNote ?? undefined) : "The admin team checks it, then the staff ID and a temporary password go to their phone."}
    >
      <form onSubmit={submit} className="grid gap-2 text-sm sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="font-medium">Full name</span>
          <input className={inputCls} value={form.fullName} onChange={set("fullName")} required minLength={2} maxLength={80} />
        </label>
        <label className="space-y-1">
          <span className="font-medium">Mobile number</span>
          <input className={inputCls} value={form.phone} onChange={set("phone")} required inputMode="tel" placeholder="98765 43210" />
        </label>
        <label className="space-y-1">
          <span className="font-medium">Role</span>
          <select className={inputCls} value={form.role} onChange={set("role")}>
            <option value="floor_staff">Floor staff</option>
            <option value="manager">Store manager</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-medium">Shift</span>
          <input className={inputCls} value={form.shift ?? ""} onChange={set("shift")} placeholder="Morning 7–3" maxLength={40} />
        </label>
        <label className="space-y-1">
          <span className="font-medium">Employee number</span>
          <input className={inputCls} value={form.employeeRef ?? ""} onChange={set("employeeRef")} placeholder="From HR, if any" maxLength={40} />
        </label>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <button className={primaryCls} disabled={send.isPending}>
            {editing ? "Resubmit" : "Send request"}
          </button>
          {editing && (
            <button type="button" className={buttonCls} onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function SwitchOff({ account, onDone }: { account: StaffAccount; onDone: (m: Message | null) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => apiPost(`/admin/v1/stores/${STORE_ID}/staff-requests/deactivate`, { staffId: account.id, reason: reason.trim() }),
    onSuccess: () =>
      onDone({
        tone: "info",
        text: `${account.name} is suspended now and signed out everywhere. The admin team will confirm switching the account off, or restore it.`,
      }),
    onError: (e) => setError(requestMessage(e)),
  });
  return (
    <Card title={`Switch off ${account.name} (${account.staffCode})`} hint="They are suspended straight away. The admin team makes it permanent or restores the account.">
      <form
        className="flex flex-wrap items-start gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <input className={`${inputCls} max-w-md flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. Left the company on 20 Oct" required minLength={2} maxLength={300} />
        <button className={`${primaryCls} bg-red-700`} disabled={send.isPending}>
          Suspend and request
        </button>
        <button type="button" className={buttonCls} onClick={() => onDone(null)}>
          Cancel
        </button>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Card>
  );
}
