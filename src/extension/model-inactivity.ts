// Watches only model-waiting intervals; local tools and approvals are excluded.
export function createModelInactivityMonitor(
  onChange: (inactive: boolean) => void,
  signal: AbortSignal,
  delayMs = 60_000,
) {
  let active = false;
  let disposed = false;
  let inactive = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const update = (value: boolean) => {
    if (inactive === value) return;
    inactive = value;
    onChange(value);
  };
  const progress = () => {
    if (!active || signal.aborted) return;
    clear();
    update(false);
    timer = setTimeout(() => {
      if (active && !signal.aborted) update(true);
    }, delayMs);
  };
  const pause = () => {
    active = false;
    clear();
    update(false);
  };
  signal.addEventListener("abort", pause, { once: true });
  return {
    start() {
      active = !disposed && !signal.aborted;
      progress();
    },
    progress,
    pause,
    dispose() {
      disposed = true;
      pause();
      signal.removeEventListener("abort", pause);
    },
  };
}
