// Writes JSON Schema for the shared contracts. The Python API tests validate against these.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AskResponse, RouteListResponse, SearchResponse, StoreInsights } from "../assist.js";
import { AddItemRequest, CartSnapshot, PairCartRequest } from "../cart.js";
import { SmartCartEvent } from "../events.js";
import { CheckoutResponse, ExitCheckResponse, Receipt } from "../order.js";
import {
  CollectResponse,
  MeResponse,
  Reservation,
  StaffAccount,
  StaffLoginResponse,
  StaffRequest,
  StaffReviewResponse,
  StaffTask,
  StockCorrection,
  StockLevel,
} from "../store.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../schema");
mkdirSync(outDir, { recursive: true });

const schemas = {
  CartSnapshot,
  PairCartRequest,
  AddItemRequest,
  SmartCartEvent,
  Receipt,
  CheckoutResponse,
  ExitCheckResponse,
  SearchResponse,
  RouteListResponse,
  AskResponse,
  StoreInsights,
  StaffLoginResponse,
  MeResponse,
  StaffAccount,
  StaffRequest,
  StaffReviewResponse,
  Reservation,
  CollectResponse,
  StaffTask,
  StockLevel,
  StockCorrection,
};
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  writeFileSync(join(outDir, `${name}.schema.json`), JSON.stringify(json, null, 2) + "\n");
}
console.log(`Wrote ${Object.keys(schemas).length} schemas to ${outDir}`);
