export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

type TimeoutSetFn = (handler: () => void, timeoutMs: number) => number;
type TimeoutClearFn = (handle: number) => void;

export type IdleController = {
  start: () => void;
  stop: () => void;
  markActivity: () => void;
  isRunning: () => boolean;
};

export function createIdleController(input: {
  onIdle: () => void;
  timeoutMs?: number;
  setTimer: TimeoutSetFn;
  clearTimer: TimeoutClearFn;
}): IdleController {
  const timeoutMs = input.timeoutMs ?? IDLE_TIMEOUT_MS;
  let handle: number | null = null;
  let running = false;

  const clear = () => {
    if (handle !== null) {
      input.clearTimer(handle);
      handle = null;
    }
  };

  const schedule = () => {
    clear();
    handle = input.setTimer(() => {
      handle = null;
      input.onIdle();
    }, timeoutMs);
  };

  return {
    start() {
      running = true;
      schedule();
    },
    stop() {
      running = false;
      clear();
    },
    markActivity() {
      if (!running) return;
      schedule();
    },
    isRunning() {
      return running;
    },
  };
}

