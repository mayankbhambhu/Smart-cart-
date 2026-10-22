import { z } from "zod";

/**
 * Milestone 4, "Find it fast": search, smart list, Ask SmartCart and floor help.
 * Stock is only ever stated from verified inventory; "unknown" means the store has no count.
 */
export const StockStatus = z.enum(["in_stock", "low", "out", "unknown"]);
export type StockStatus = z.infer<typeof StockStatus>;

export const DietTag = z.enum(["veg", "jain", "no_added_sugar"]);
export type DietTag = z.infer<typeof DietTag>;

export const SearchResult = z.object({
  productId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string(),
  pricePaise: z.number().int(),
  mrpPaise: z.number().int(),
  /** Price per kg, litre or piece for comparing brands and pack sizes; null if the pack size is unknown. */
  unitPricePaise: z.number().int().nullable(),
  unit: z.enum(["kg", "L", "pc"]).nullable(),
  dietTags: z.array(z.string()),
  aisle: z.string().nullable(),
  shelf: z.string().nullable(),
  stock: StockStatus,
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({ query: z.string(), results: z.array(SearchResult) });
export type SearchResponse = z.infer<typeof SearchResponse>;

export const RouteListRequest = z.object({ lines: z.array(z.string()).min(1).max(60) });
export type RouteListRequest = z.infer<typeof RouteListRequest>;

export const RoutedItem = z.object({
  /** The shopper's own words for this item. */
  line: z.string(),
  product: SearchResult,
  /** Other products that matched the line, for "show other brands". */
  alternatives: z.number().int(),
});
export type RoutedItem = z.infer<typeof RoutedItem>;

export const RouteListResponse = z.object({
  /** In walking order from the entrance. */
  stops: z.array(z.object({ aisle: z.string(), category: z.string(), items: z.array(RoutedItem) })),
  notFound: z.array(z.string()),
  matched: z.number().int(),
  total: z.number().int(),
});
export type RouteListResponse = z.infer<typeof RouteListResponse>;

export const ChatTurn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) });
export type ChatTurn = z.infer<typeof ChatTurn>;

export const AskRequest = z.object({
  message: z.string().min(1).max(500),
  history: z.array(ChatTurn).max(12).optional(),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const AskResponse = z.object({
  reply: z.string(),
  /** "ai" when Claude wrote the reply from store facts; "rules" when it was built without AI. */
  mode: z.enum(["ai", "rules"]),
  /** The store facts the reply is based on. */
  products: z.array(SearchResult),
});
export type AskResponse = z.infer<typeof AskResponse>;

export const HelpTopic = z.enum(["find_item", "price", "stock", "other"]);
export type HelpTopic = z.infer<typeof HelpTopic>;
export const HelpStatus = z.enum(["open", "acknowledged", "resolved", "cancelled"]);
export type HelpStatus = z.infer<typeof HelpStatus>;

export const HelpRequest = z.object({
  id: z.string(),
  storeId: z.string(),
  cartId: z.string().nullable(),
  /** Aisle of the last item the shopper scanned, so staff know where to go. */
  aisle: z.string().nullable(),
  topic: HelpTopic,
  note: z.string().nullable(),
  status: HelpStatus,
  shopperName: z.string().nullable(),
  /** The floor assistant who took the request, so the shopper sees who is coming. */
  staffName: z.string().nullable().optional(),
  createdAt: z.iso.datetime(),
  acknowledgedAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type HelpRequest = z.infer<typeof HelpRequest>;

export const HelpCreateRequest = z.object({
  topic: HelpTopic.optional(),
  note: z.string().max(200).nullable().optional(),
});
export type HelpCreateRequest = z.infer<typeof HelpCreateRequest>;

export const StoreInsights = z.object({
  days: z.number().int(),
  searches: z.number().int(),
  missedSearches: z.number().int(),
  topMissed: z.array(z.object({ query: z.string(), count: z.number().int(), lastAt: z.iso.datetime() })),
  help: z.object({
    total: z.number().int(),
    open: z.number().int(),
    avgMinutesToAcknowledge: z.number().nullable(),
    byTopic: z.record(z.string(), z.number().int()),
    byAisle: z.record(z.string(), z.number().int()),
  }),
});
export type StoreInsights = z.infer<typeof StoreInsights>;
