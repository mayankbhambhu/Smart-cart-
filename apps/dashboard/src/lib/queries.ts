import type { Reservation, StaffAccount, StaffRequest, StaffRequestStatus, StaffTask, StockCorrection } from "@smart-cart/contracts";
import { apiGet, STORE_ID } from "./api";

const store = `/admin/v1/stores/${STORE_ID}`;

export const reservationsQuery = () => ({
  queryKey: ["reservations", STORE_ID],
  queryFn: () => apiGet<{ reservations: Reservation[] }>(`${store}/reservations`).then((r) => r.reservations),
});

export const tasksQuery = () => ({
  queryKey: ["tasks", STORE_ID],
  queryFn: () => apiGet<{ tasks: StaffTask[] }>(`${store}/tasks`).then((r) => r.tasks),
});

export const staffQuery = () => ({
  queryKey: ["staff", STORE_ID],
  queryFn: () => apiGet<{ staff: StaffAccount[] }>(`${store}/staff`).then((r) => r.staff),
});

/** This store's account requests, as its managers raised them. */
export const storeRequestsQuery = () => ({
  queryKey: ["staffRequests", STORE_ID],
  queryFn: () => apiGet<{ requests: StaffRequest[] }>(`${store}/staff-requests`).then((r) => r.requests),
});

/** Every store's requests, for the SmartCart admin team. */
export const staffRequestsQuery = (status: StaffRequestStatus | null) => ({
  queryKey: ["staffRequests", "all", status ?? "any"],
  queryFn: () =>
    apiGet<{ requests: StaffRequest[] }>(`/admin/v1/staff-requests${status ? `?status=${status}` : ""}`).then((r) => r.requests),
});

export const correctionsQuery = (days: number) => ({
  queryKey: ["corrections", STORE_ID, days],
  queryFn: () =>
    apiGet<{ corrections: StockCorrection[] }>(`${store}/reports/stock-corrections?days=${days}`).then((r) => r.corrections),
});
