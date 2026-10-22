import { z } from "zod";
import { CartSnapshot } from "./cart.js";

/**
 * The two sides of SmartCart. Shoppers reserve items for pickup; the store team (floor staff on
 * handhelds, managers on the dashboard) pick reservations, work tasks and correct stock. Store-team
 * accounts exist only after the SmartCart admin team approves a manager's request.
 */
export const StaffRole = z.enum(["floor_staff", "manager", "admin"]);
export type StaffRole = z.infer<typeof StaffRole>;
export const StaffStatus = z.enum(["active", "suspended", "deactivated"]);
export type StaffStatus = z.infer<typeof StaffStatus>;

export const StaffAccount = z.object({
  id: z.string(),
  /** What staff type to sign in, e.g. "S01-0042". */
  staffCode: z.string().nullable(),
  name: z.string().nullable(),
  /** Registered mobile, +91XXXXXXXXXX. */
  phone: z.string().nullable(),
  role: StaffRole,
  storeId: z.string(),
  shift: z.string().nullable(),
  status: StaffStatus,
  mustChangePassword: z.boolean(),
  createdAt: z.iso.datetime().nullable(),
});
export type StaffAccount = z.infer<typeof StaffAccount>;

export const StaffLoginRequest = z.object({
  /** Staff ID or registered phone number. */
  login: z.string().min(1).max(40),
  password: z.string().min(1).max(200),
});
export type StaffLoginRequest = z.infer<typeof StaffLoginRequest>;

export const StaffLoginResponse = z.object({
  /** Bearer token for the API, valid 12 hours. */
  token: z.string(),
  expiresAt: z.iso.datetime(),
  /** True after approval or a resend: only the change-password call works until it is changed. */
  mustChangePassword: z.boolean(),
  staff: StaffAccount,
});
export type StaffLoginResponse = z.infer<typeof StaffLoginResponse>;

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

/** GET /v1/me: the server decides which side a signed-in person sees, not the login tab. */
export const MeResponse = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  side: z.enum(["shopper", "store"]),
  role: z.union([z.literal("shopper"), StaffRole]),
  staff: StaffAccount.nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const StaffRequestStatus = z.enum(["pending", "approved", "rejected", "changes_requested"]);
export type StaffRequestStatus = z.infer<typeof StaffRequestStatus>;

export const StaffRequest = z.object({
  id: z.string(),
  type: z.enum(["create", "deactivate"]),
  storeId: z.string(),
  fullName: z.string(),
  phone: z.string(),
  role: StaffRole,
  shift: z.string().nullable(),
  employeeRef: z.string().nullable(),
  /** The account created by approval, or the account a deactivation is about. */
  staffId: z.string().nullable(),
  reason: z.string().nullable(),
  status: StaffRequestStatus,
  requestedBy: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type StaffRequest = z.infer<typeof StaffRequest>;

export const StaffCreateRequest = z.object({
  fullName: z.string().min(2).max(80),
  phone: z.string().min(10).max(20),
  role: z.enum(["floor_staff", "manager"]),
  shift: z.string().max(40).nullable().optional(),
  employeeRef: z.string().max(40).nullable().optional(),
});
export type StaffCreateRequest = z.infer<typeof StaffCreateRequest>;

export const StaffReviewRequest = z.object({
  action: z.enum(["approve", "reject", "request_changes"]),
  /** Required to reject or send back. */
  note: z.string().max(300).nullable().optional(),
});
export type StaffReviewRequest = z.infer<typeof StaffReviewRequest>;

/** What was texted. With the development "log" provider the message itself comes back for the demo. */
export const SmsReceipt = z.object({
  to: z.string(),
  provider: z.string(),
  devMessage: z.string().optional(),
});
export type SmsReceipt = z.infer<typeof SmsReceipt>;

export const StaffReviewResponse = z.object({
  request: StaffRequest,
  staff: StaffAccount.optional(),
  sms: SmsReceipt.optional(),
});
export type StaffReviewResponse = z.infer<typeof StaffReviewResponse>;

// ---- reservations -------------------------------------------------------------------------------

export const PickupSlot = z.object({ start: z.iso.datetime(), end: z.iso.datetime(), label: z.string() });
export type PickupSlot = z.infer<typeof PickupSlot>;

export const ReservationStatus = z.enum(["reserved", "picked", "collected", "expired", "cancelled"]);
export type ReservationStatus = z.infer<typeof ReservationStatus>;

export const ReservationItem = z.object({
  productId: z.string(),
  name: z.string(),
  qty: z.number().int(),
  pickedQty: z.number().int(),
  aisle: z.string().nullable(),
  shelf: z.string().nullable(),
  pricePaise: z.number().int().nullable(),
});
export type ReservationItem = z.infer<typeof ReservationItem>;

/** An unpaid hold. Stock is held until collected, cancelled, or one hour after the slot ends. */
export const Reservation = z.object({
  id: z.string(),
  storeId: z.string(),
  status: ReservationStatus,
  slotStart: z.iso.datetime(),
  slotEnd: z.iso.datetime(),
  /** The parked cart holding the picked items. */
  cartCode: z.string().nullable(),
  shopperName: z.string().nullable(),
  pickedBy: z.string().nullable(),
  /** In walking order. */
  items: z.array(ReservationItem),
  itemCount: z.number().int(),
  totalPaise: z.number().int(),
  createdAt: z.iso.datetime().nullable(),
  pickedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
});
export type Reservation = z.infer<typeof Reservation>;

export const ReservationCreateRequest = z.object({
  items: z
    .array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(40),
  slotStart: z.iso.datetime(),
});
export type ReservationCreateRequest = z.infer<typeof ReservationCreateRequest>;

/** Collecting pairs the shopper with the parked cart and moves the items into it. */
export const CollectResponse = z.object({ reservation: Reservation, cart: CartSnapshot });
export type CollectResponse = z.infer<typeof CollectResponse>;

// ---- floor work ---------------------------------------------------------------------------------

export const TaskType = z.enum(["restock", "pick", "stock_check", "other"]);
export type TaskType = z.infer<typeof TaskType>;

export const StaffTask = z.object({
  id: z.string(),
  type: TaskType,
  title: z.string(),
  note: z.string().nullable(),
  /** The product for restock and stock checks, the reservation for picks. */
  refId: z.string().nullable(),
  status: z.enum(["open", "done", "cancelled"]),
  assignedTo: z.string().nullable(),
  assignedName: z.string().nullable(),
  dueAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime().nullable(),
  doneAt: z.iso.datetime().nullable(),
  doneBy: z.string().nullable(),
});
export type StaffTask = z.infer<typeof StaffTask>;

export const TaskCreateRequest = z.object({
  type: z.enum(["restock", "stock_check", "other"]),
  title: z.string().min(2).max(120),
  note: z.string().max(300).nullable().optional(),
  productId: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
});
export type TaskCreateRequest = z.infer<typeof TaskCreateRequest>;

export const StockLevel = z.object({
  productId: z.string(),
  barcode: z.string(),
  name: z.string(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  available: z.number().int(),
  lowStockThreshold: z.number().int(),
  aisle: z.string().nullable(),
  shelf: z.string().nullable(),
});
export type StockLevel = z.infer<typeof StockLevel>;

export const StockCorrectionRequest = z.object({
  barcode: z.string().min(1),
  counted: z.number().int().min(0).max(100000),
  reason: z.string().min(2).max(200),
});
export type StockCorrectionRequest = z.infer<typeof StockCorrectionRequest>;

export const StockCorrection = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  systemQty: z.number().int(),
  countedQty: z.number().int(),
  delta: z.number().int(),
  reason: z.string(),
  staffName: z.string().nullable(),
  at: z.iso.datetime().nullable(),
});
export type StockCorrection = z.infer<typeof StockCorrection>;
