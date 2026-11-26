"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./api";
import {
  getSubscriptionStatus,
  PUSH_CHANGED_EVENT,
  subscribe,
  unsubscribe,
  type PushStatus,
} from "./push";

export function usePush() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await getSubscriptionStatus());
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(PUSH_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PUSH_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await subscribe();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribe();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, error, enable, disable, refresh };
}
