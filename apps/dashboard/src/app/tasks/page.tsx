"use client";

import type { TaskCreateRequest, TaskType } from "@smart-cart/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, buttonCls, Card, inputCls, Loading, Notice, PageHead, primaryCls } from "@/components/ui";
import { apiGet, apiPost, STORE_ID, type InventoryItem } from "@/lib/api";
import { staffQuery, tasksQuery } from "@/lib/queries";
import { dateTime, requestMessage, roleLabel, time } from "@/lib/team";

const taskType: Record<TaskType, string> = { restock: "Restock", pick: "Pick", stock_check: "Stock check", other: "Other" };

/** Who is on the team today and what the floor has to do. Floor staff see these on the handheld. */
export default function TasksPage() {
  const queryClient = useQueryClient();
  const tasks = useQuery(tasksQuery());
  const staff = useQuery(staffQuery());
  const active = (staff.data ?? []).filter((s) => s.status === "active");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tasks", STORE_ID] });

  const assign = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string | null }) =>
      apiPost(`/admin/v1/stores/${STORE_ID}/tasks/${id}/assign`, { assignedTo: to }),
    onSettled: refresh,
  });

  if (!tasks.data) return <Loading error={tasks.error} />;
  const open = tasks.data.filter((t) => t.status === "open");
  const done = tasks.data.filter((t) => t.status === "done");
  const openFor = (id: string) => open.filter((t) => t.assignedTo === id).length;

  return (
    <section className="space-y-5">
      <PageHead title="Staff and tasks" hint="Tasks show on the floor team's handhelds. Unassigned tasks are for whoever gets there first." />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card title={`Open tasks (${open.length})`} hint="Pick tasks close when the reservation is picked. Restock tasks appear when stock runs low.">
            {open.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing open. Good work, team.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {open.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <Badge tone={t.type === "pick" ? "amber" : t.type === "restock" ? "red" : "blue"}>{taskType[t.type]}</Badge>{" "}
                        {t.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t.note && `${t.note} · `}
                        {t.dueAt ? `Due ${dateTime(t.dueAt)}` : `Raised ${dateTime(t.createdAt)}`}
                      </p>
                    </div>
                    <select
                      aria-label={`Assign ${t.title}`}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                      value={t.assignedTo ?? ""}
                      disabled={assign.isPending}
                      onChange={(e) => assign.mutate({ id: t.id, to: e.target.value || null })}
                    >
                      <option value="">Anyone on the floor</option>
                      {active.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Done in the last 24 hours">
            {done.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing finished yet today.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {done.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className="text-slate-700">
                      {taskType[t.type]}: {t.title}
                    </span>
                    <span className="whitespace-nowrap text-xs text-slate-500">
                      {t.doneBy} · {time(t.doneAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <NewTask staff={active} onCreated={refresh} />
          <Card title="Team" hint="Active accounts at this store.">
            {!staff.data ? (
              <Loading error={staff.error} />
            ) : (
              <ul className="space-y-1.5 text-sm">
                {active.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>
                      {s.name}
                      <span className="block text-xs text-slate-500">
                        {roleLabel[s.role]}
                        {s.shift && ` · ${s.shift}`}
                      </span>
                    </span>
                    {openFor(s.id) > 0 && <Badge tone="grey">{openFor(s.id)} open</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}

function NewTask({ staff, onCreated }: { staff: { id: string; name: string | null }[]; onCreated: () => void }) {
  const [type, setType] = useState<TaskCreateRequest["type"]>("restock");
  const [product, setProduct] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const products = useQuery({
    queryKey: ["inventory", STORE_ID, "", false],
    queryFn: () => apiGet<{ items: InventoryItem[] }>(`/admin/v1/stores/${STORE_ID}/inventory?lowStockOnly=false`),
  });
  const match = products.data?.items.find((p) => p.name === product.trim());

  const create = useMutation({
    mutationFn: (body: TaskCreateRequest) => apiPost<{ id: string }>(`/admin/v1/stores/${STORE_ID}/tasks`, body),
    onSuccess: () => {
      setMessage({ tone: "ok", text: "Task sent to the floor." });
      setTitle("");
      setNote("");
      setProduct("");
      onCreated();
    },
    onError: (e) => setMessage({ tone: "error", text: requestMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const verb = type === "restock" ? "Restock" : "Check stock of";
    const finalTitle = title.trim() || (match ? `${verb} ${match.name}` : "");
    if (finalTitle.length < 2) return setMessage({ tone: "error", text: "Give the task a title or pick a product." });
    create.mutate({ type, title: finalTitle, note: note.trim() || null, productId: match?.productId ?? null, assignedTo: to || null });
  };

  return (
    <Card title="New task">
      <form onSubmit={submit} className="space-y-2 text-sm">
        <div className="flex gap-1" role="group" aria-label="Task type">
          {(["restock", "stock_check", "other"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={`${buttonCls} ${type === t ? "border-brand bg-brand-soft text-brand" : ""}`}>
              {taskType[t]}
            </button>
          ))}
        </div>
        {type !== "other" && (
          <label className="block space-y-1">
            <span className="font-medium">Product</span>
            <input className={inputCls} list="task-products" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Start typing a product name" />
            <datalist id="task-products">
              {products.data?.items.map((p) => <option key={p.productId} value={p.name} />)}
            </datalist>
            {match && (
              <span className="text-xs text-slate-500">
                Aisle {match.aisle ?? "?"}, shelf {match.shelf ?? "?"} · {match.available} available
              </span>
            )}
          </label>
        )}
        <label className="block space-y-1">
          <span className="font-medium">Title {type !== "other" && <span className="font-normal text-slate-500">(optional)</span>}</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={type === "other" ? "Clean spill in aisle B2" : ""} />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Note</span>
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Assign to</span>
          <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Anyone on the floor</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <button className={primaryCls} disabled={create.isPending}>
          Send to the floor
        </button>
      </form>
    </Card>
  );
}
