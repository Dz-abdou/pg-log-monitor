import { useEffect, useRef } from "react";

type UsePollingOptions = {
  enabled: boolean;
  intervalMs: number;
  immediate?: boolean;
};

export function usePolling(
  callback: () => Promise<void> | void,
  { enabled, intervalMs, immediate = true }: UsePollingOptions,
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    async function runCallback() {
      await callbackRef.current();
    }

    if (immediate) {
      void runCallback();
    }

    const timerId = window.setInterval(() => {
      void runCallback();
    }, intervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [enabled, immediate, intervalMs]);
}
