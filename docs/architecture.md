# Architecture

The full architecture doc lives here: https://claude.ai/artifact/L9RV5J4e2eF8kPDSRCfxMd

Key decisions it records, so they travel with the code:

- **Event-driven cart.** Every cart change is an event with one envelope
  (`packages/contracts/src/events.ts`). `source` is `phone` in V1 and `cart` when V2 hardware
  publishes through AWS IoT Core; consumers do not care which.
- **Server is the source of truth** for prices, GST and totals. Money is integer paise; GST rates
  are basis points; Indian shelf prices are GST inclusive, so tax is extracted, not added
  (`apps/api/src/lib/money.ts`).
- **Every store-scoped table carries `store_id`** so a second store is data, not a migration.
- **Modular monolith.** One Fastify service whose modules own their own tables.
- **Payments** go through a `PaymentProvider` interface: Stripe first, a Razorpay adapter if the
  pilot needs UPI. An order is paid only when the provider's webhook says so.
- **AWS ap-south-1 from the first deploy**, defined in Terraform (`infra/terraform`).
