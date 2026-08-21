/**
 * Runs `handler` over `items` with at most `concurrency` in flight.
 *
 * Both the screening and monitoring loops are dominated by waiting on RPC, so
 * they need the same bounded fan-out. Request pacing lives in the RPC and price
 * clients, which is why this only has to cap how many items are open at once.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      await handler(item);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
}
