export interface InboundGate {
  ready: Promise<void>;
  release(): void;
  awaitable(routed: Promise<void>): Promise<void> | undefined;
}

export function createInboundGate(): InboundGate {
  let open = false;
  let resolve!: () => void;
  const ready = new Promise<void>((r) => {
    resolve = r;
  });
  return {
    ready,
    release() {
      open = true;
      resolve();
    },
    // Before release the adapter may still be inside setup(), which the host awaits before releasing, so waiting there would deadlock.
    awaitable: (routed) => (open ? routed : undefined),
  };
}
