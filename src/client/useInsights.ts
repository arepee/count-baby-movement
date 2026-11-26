"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/client/api";
import type { InsightsResponse } from "@/client/types";

/** Loads GET /api/insights and refetches whenever the page becomes visible again. */
export function useInsights(days = 28) {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<InsightsResponse>(`/api/insights?days=${days}`);
      setData(r);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [days]);

  useEffect(() => {
    void load();
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  return { data, error, reload: load };
}
