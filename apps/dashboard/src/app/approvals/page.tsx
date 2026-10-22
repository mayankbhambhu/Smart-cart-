"use client";

import type { StaffRequest, StaffRequestStatus, StaffReviewRequest, StaffReviewResponse } from "@smart-cart/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, buttonCls, Card, inputCls, Loading, Notice, PageHead, primaryCls } from "@/components/ui";
import { apiPost } from "@/lib/api";
import { staffRequestsQuery } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { dateTime, phoneLabel, requestMessage, requestStatus, roleLabel, smsText } from "@/lib/team";

const filters: { status: StaffRequestStatus | null; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "changes_requested", label: "Sent back" },
  { status: null, label: "All" },
];

/**
 * The SmartCart admin team's queue: new accounts and switch-offs requested by store managers.
 * Approving a new account creates the staff ID, registers the phone and texts a temporary password.
 */
export default function ApprovalsPage() {
  const { session } = useSession();
  const [status, setStatus] = useState<StaffRequestStatus | null>("pending");
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const { data, error } = useQuery({ ...staffRequestsQuery(status), enabled: session?.role === "admin" });

  if (session?.role !== "admin") {
    return <Notice tone="info">Only the SmartCart admin team approves store-team accounts.</Notice>;
  }

  return (
    <section className="space-y-5">
      <PageHead title="Account approvals" hint="Requests from store managers in every store. Rejecting or sending back needs a note the manager will see.">
        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-0.5 text-sm" role="group" aria-label="Show">
          {filters.map((f) => (
            <button
              key={f.label}
              onClick={() => setStatus(f.status)}
              aria-pressed={status === f.status}
              className={`rounded px-2.5 py-1 ${status === f.status ? "bg-brand-soft font-medium text-brand" : "text-slate-600"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </PageHead>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing here. New requests appear as managers raise them.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((r) => (
            <RequestCard key={r.id} request={r} onMessage={setMessage} />
          ))}
        </div>
      )}
    </section>
  );
}

function RequestCard({ request: r, onMessage }: { request: StaffRequest; onMessage: (m: { tone: "ok" | "error" | "info"; text: string }) => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: (body: StaffReviewRequest) => apiPost<StaffReviewResponse>(`/admin/v1/staff-requests/${r.id}/review`, body),
    onSuccess: (res, body) => {
      const who = r.fullName;
      if (body.action === "approve" && r.type === "create") {
        onMessage({ tone: "ok", text: smsText(`Approved. ${who} is ${res.staff?.staffCode}; the staff ID and temporary password were sent`, res.sms) });
      } else if (body.action === "approve") {
        onMessage({ tone: "ok", text: `${who}'s account is switched off for good.` });
      } else if (body.action === "reject" && r.type === "deactivate") {
        onMessage({ tone: "info", text: `Not switched off. ${who}'s account is active again.` });
      } else {
        onMessage({ tone: "info", text: body.action === "reject" ? `Rejected ${who}'s request.` : `Sent back to the manager with your note.` });
      }
      void queryClient.invalidateQueries({ queryKey: ["staffRequests"] });
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => onMessage({ tone: "error", text: requestMessage(e) }),
  });
  const decide = (action: StaffReviewRequest["action"]) => review.mutate({ action, note: note.trim() || null });
  const needsNote = note.trim().length === 0;

  return (
    <Card>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            {r.type === "create" ? "New account" : "Switch off account"} · {r.fullName}
          </span>
          <Badge tone={requestStatus[r.status].tone}>{requestStatus[r.status].label}</Badge>
        </div>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-slate-700">
          <dt className="text-slate-500">Store</dt>
          <dd>{r.storeId}</dd>
          <dt className="text-slate-500">Role</dt>
          <dd>{roleLabel[r.role]}</dd>
          <dt className="text-slate-500">Phone</dt>
          <dd>{phoneLabel(r.phone)}</dd>
          {r.shift && (
            <>
              <dt className="text-slate-500">Shift</dt>
              <dd>{r.shift}</dd>
            </>
          )}
          {r.employeeRef && (
            <>
              <dt className="text-slate-500">Employee no.</dt>
              <dd>{r.employeeRef}</dd>
            </>
          )}
          {r.reason && (
            <>
              <dt className="text-slate-500">Reason</dt>
              <dd>{r.reason}</dd>
            </>
          )}
          <dt className="text-slate-500">Asked by</dt>
          <dd>
            {r.requestedBy ?? "a manager"}, {dateTime(r.createdAt)}
          </dd>
        </dl>
        {r.type === "deactivate" && r.status === "pending" && (
          <p className="text-xs text-amber-800">The account is suspended while this waits.</p>
        )}
        {r.reviewNote && (
          <p className="rounded bg-slate-50 px-2 py-1 text-xs">
            {r.reviewedBy}: {r.reviewNote}
          </p>
        )}
        {r.status === "pending" && (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the manager (needed to reject or send back)" maxLength={300} />
            <div className="flex flex-wrap gap-2">
              <button className={primaryCls} disabled={review.isPending} onClick={() => decide("approve")}>
                {r.type === "create" ? "Approve and send login" : "Approve switch-off"}
              </button>
              {r.type === "create" && (
                <button className={buttonCls} disabled={review.isPending || needsNote} onClick={() => decide("request_changes")}>
                  Send back
                </button>
              )}
              <button className={`${buttonCls} text-red-700`} disabled={review.isPending || needsNote} onClick={() => decide("reject")}>
                {r.type === "create" ? "Reject" : "Reject and restore"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
