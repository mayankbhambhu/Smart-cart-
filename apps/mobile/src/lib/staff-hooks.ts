import { useAuth } from "./auth-store";
import { DEFAULT_STORE_ID } from "./config";

/** The store this staff member works at. */
export const useStaffStore = () => useAuth((s) => (s.session?.kind === "staff" ? s.session.storeId : DEFAULT_STORE_ID));

/** Staff screens refresh this often; help and picks need to feel live on the floor. */
export const STAFF_POLL_MS = 5_000;
