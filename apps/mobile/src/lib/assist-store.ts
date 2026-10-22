import type { ChatTurn, DietTag, HelpRequest, HelpTopic, RouteListResponse, SearchResult } from "@smart-cart/contracts";
import { create } from "zustand";
import { api } from "./api";
import { DEFAULT_STORE_ID } from "./config";
import { storage } from "./storage";

const BUDGET_KEY = "smartcart.budgetPaise";
const DIET_KEY = "smartcart.dietPref";

export type ChatMessage = ChatTurn & { products?: SearchResult[]; mode?: "ai" | "rules" };

type AssistState = {
  /** The store the shopper is in: their cart's store, or the default pilot store. */
  storeId: string;
  /** The shopper's latest floor-help request, kept live by help.* events on the cart socket. */
  help: HelpRequest | null;
  budgetPaise: number | null;
  /** The shopper's diet preference (e.g. veg only, Jain): pre-filters browse and search. */
  dietPref: DietTag[];
  listText: string;
  route: RouteListResponse | null;
  /** Product ids ticked off on the route. */
  picked: Record<string, true>;
  chat: ChatMessage[];

  setStoreId: (storeId: string) => void;
  setHelp: (request: HelpRequest | null) => void;
  refreshHelp: () => Promise<void>;
  callHelp: (topic: HelpTopic, note?: string) => Promise<HelpRequest>;
  cancelHelp: () => Promise<void>;
  loadBudget: () => Promise<void>;
  setBudget: (paise: number | null) => Promise<void>;
  setDietPref: (diet: DietTag[]) => Promise<void>;
  setListText: (text: string) => void;
  planRoute: (lines: string[]) => Promise<RouteListResponse>;
  togglePicked: (productId: string) => void;
  ask: (message: string) => Promise<void>;
};

export const useAssist = create<AssistState>((set, get) => ({
  storeId: DEFAULT_STORE_ID,
  help: null,
  budgetPaise: null,
  dietPref: [],
  listText: "",
  route: null,
  picked: {},
  chat: [],

  setStoreId: (storeId) => set({ storeId }),
  setHelp: (help) => set({ help }),

  refreshHelp: async () => set({ help: await api.myHelp(get().storeId) }),

  callHelp: async (topic, note) => {
    const help = await api.requestHelp(get().storeId, topic, note);
    set({ help });
    return help;
  },

  cancelHelp: async () => {
    const help = get().help;
    if (help) set({ help: await api.cancelHelp(get().storeId, help.id) });
  },

  loadBudget: async () => {
    const [saved, diet] = await Promise.all([
      storage.get(BUDGET_KEY).catch(() => null),
      storage.get(DIET_KEY).catch(() => null),
    ]);
    set({
      budgetPaise: saved ? Number(saved) || null : null,
      dietPref: diet ? (diet.split(",").filter(Boolean) as DietTag[]) : [],
    });
  },

  setDietPref: async (dietPref) => {
    set({ dietPref });
    await (dietPref.length ? storage.set(DIET_KEY, dietPref.join(",")) : storage.remove(DIET_KEY)).catch(() => {});
  },

  setBudget: async (paise) => {
    set({ budgetPaise: paise });
    await (paise ? storage.set(BUDGET_KEY, String(paise)) : storage.remove(BUDGET_KEY)).catch(() => {});
  },

  setListText: (listText) => set({ listText }),

  planRoute: async (lines) => {
    const route = await api.routeList(get().storeId, lines);
    set({ route, picked: {} });
    return route;
  },

  togglePicked: (productId) => {
    const picked = { ...get().picked };
    if (picked[productId]) delete picked[productId];
    else picked[productId] = true;
    set({ picked });
  },

  ask: async (message) => {
    const history: ChatTurn[] = get().chat.map(({ role, content }) => ({ role, content }));
    set({ chat: [...get().chat, { role: "user", content: message }] });
    const res = await api.ask(get().storeId, message, history.slice(-10));
    set({ chat: [...get().chat, { role: "assistant", content: res.reply, products: res.products, mode: res.mode }] });
  },
}));
