import type { SmartCartEvent } from "@smart-cart/contracts";
import { io, type Socket } from "socket.io-client";
import { API_URL, DEMO } from "./config";
import { demo } from "./demo";

/**
 * Opens the Socket.IO connection for one cart session. On every (re)connect it joins the cart
 * room and the server replies with a full cart.snapshot, so the app never drifts from the
 * server after a dropped connection. Returns a function that closes it.
 *
 * `onForeground` lets the app say when it returns to the foreground (the app passes React Native's
 * AppState; the Node smoke test has none), so it can reconnect at once instead of on the next backoff.
 */
export function connectCart(opts: {
  token: string;
  sessionId: string;
  onEvent: (e: SmartCartEvent) => void;
  onLive: (live: boolean) => void;
  onForeground?: (reconnect: () => void) => () => void;
}): () => void {
  if (DEMO) return demo().connect(opts.sessionId, opts.onEvent, opts.onLive);
  const socket: Socket = io(API_URL, {
    auth: { token: opts.token },
    transports: ["websocket"],
    // Keep trying for as long as the cart is open, backing off to every 10 s with some jitter so a
    // whole store's phones don't reconnect at the same instant after the Wi-Fi blips.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
  });
  socket.on("connect", () => {
    socket.emit("join", { room: "cart", sessionId: opts.sessionId }, (res: { ok: boolean }) => opts.onLive(res.ok));
  });
  socket.on("disconnect", () => opts.onLive(false));
  socket.on("connect_error", () => opts.onLive(false));
  socket.on("event", opts.onEvent);
  // Phones drop sockets while the app is in the background; reconnect as soon as it's back, without
  // waiting for the next backoff step. The join on connect brings a fresh snapshot.
  const stopWatching = opts.onForeground?.(() => {
    if (!socket.connected) socket.connect();
  });
  return () => {
    stopWatching?.();
    socket.removeAllListeners();
    socket.disconnect();
  };
}
