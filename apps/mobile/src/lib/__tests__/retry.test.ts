import { ApiError } from "../api";
import { delayFor, retryable, withRetry } from "../retry";

const noWait = async () => {};

test("retries a dropped connection with the same call until it goes through", async () => {
  let calls = 0;
  const seen: number[] = [];
  const out = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new ApiError(0, "network");
      return "added";
    },
    { sleep: noWait, onRetry: (n) => seen.push(n) },
  );
  expect(out).toBe("added");
  expect(calls).toBe(3);
  expect(seen).toEqual([1, 2]);
});

test("never retries an answer like cart_in_use, and gives up after the last delay", async () => {
  let calls = 0;
  await expect(
    withRetry(async () => {
      calls += 1;
      throw new ApiError(409, "cart_in_use");
    }, { sleep: noWait }),
  ).rejects.toMatchObject({ code: "cart_in_use" });
  expect(calls).toBe(1);

  calls = 0;
  await expect(
    withRetry(async () => {
      calls += 1;
      throw new ApiError(503, "unknown");
    }, { sleep: noWait, delays: [1, 1] }),
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(3);
});

test("waits as long as a rate limit asks, within reason", () => {
  expect(retryable(new ApiError(429, "rate_limited"))).toBe(true);
  expect(retryable(new Error("boom"))).toBe(false);
  expect(delayFor(new ApiError(429, "rate_limited", { retryAfterSeconds: 3 }), 0)).toBe(3000);
  expect(delayFor(new ApiError(429, "rate_limited", { retryAfterSeconds: 90 }), 0)).toBe(15_000);
  expect(delayFor(new ApiError(0, "network"), 2)).toBe(2000);
});
