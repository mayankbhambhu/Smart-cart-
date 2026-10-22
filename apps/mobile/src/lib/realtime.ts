import type { SmartCartEvent } from "@smart-cart/contracts";
import { io, type Socket } from "socket.io-client";
import { API_URL } from "./config";

/**
 * Opens the Socket.IO connection for one cart session. On every (re)connect it joins the cart
 * room and the server replies with a full cart.snapshot, so the app never drifts from the
 * server after a dropped connection. Returns a function that closes it.
 */
export function connectCart(opts: {
  token: string;
  sessionId: string;
  onEvent: (e: SmartCartEvent) => void;
  onLive: (live: boolean) => void;
}): () => void {
  const socket: Socket = io(API_URL, { auth: { token: opts.token }, transports: ["websocket"] });
  socket.on("connect", () => {
    socket.emit("join", { room: "cart", sessionId: opts.sessionId }, (res: { ok: boolean }) => opts.onLive(res.ok));
  });
  socket.on("disconnect", () => opts.onLive(false));
  socket.on("connect_error", () => opts.onLive(false));
  socket.on("event", opts.onEvent);
  return () => {
    socket.removeAllListeners();
    socket.disconnect();
  };
}
