import type { DietTag, Offer } from "@smart-cart/contracts";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { create } from "zustand";
import { api } from "./api";
import { storage } from "./storage";

const ALERTS_KEY = "smartcart.dealAlerts";

type DealsState = {
  /** The shopper's choice: tell me about deals in the aisle I'm in. On unless they turn it off. */
  alertsOn: boolean;
  /** The aisle of the item the shopper scanned last: where their cart is now. */
  aisle: string | null;
  /** The deal nudge on the cart screen, until dismissed or the next aisle. */
  alert: { aisle: string; offers: Offer[] } | null;
  /** Aisles already announced on this cart, so each aisle nudges once. */
  seen: Record<string, true>;
  sessionId: string | null;

  load: () => Promise<void>;
  setAlertsOn: (on: boolean) => Promise<void>;
  /** After a scan: if this is a new aisle with deals the shopper hasn't got, show them (US-08). */
  enteredAisle: (args: { storeId: string; sessionId: string; aisle: string | null; diet: DietTag[]; inCart: string[] }) => Promise<void>;
  dismiss: () => void;
};

export const useDeals = create<DealsState>((set, get) => ({
  alertsOn: true,
  aisle: null,
  alert: null,
  seen: {},
  sessionId: null,

  load: async () => {
    const saved = await storage.get(ALERTS_KEY).catch(() => null);
    set({ alertsOn: saved !== "off" });
  },

  setAlertsOn: async (alertsOn) => {
    set({ alertsOn, alert: alertsOn ? get().alert : null });
    await (alertsOn ? storage.remove(ALERTS_KEY) : storage.set(ALERTS_KEY, "off")).catch(() => {});
  },

  enteredAisle: async ({ storeId, sessionId, aisle, diet, inCart }) => {
    if (sessionId !== get().sessionId) set({ sessionId, seen: {}, alert: null, aisle: null });
    if (!aisle || aisle === get().aisle) return;
    set({ aisle });
    if (!get().alertsOn || get().seen[aisle]) return;
    const offers = (await api.offers(storeId, aisle, diet).catch(() => [])).filter((o) => !inCart.includes(o.productId));
    // The shopper may have moved on while this loaded.
    if (offers.length === 0 || get().aisle !== aisle) return;
    set({ alert: { aisle, offers }, seen: { ...get().seen, [aisle]: true } });
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },

  dismiss: () => set({ alert: null }),
}));
