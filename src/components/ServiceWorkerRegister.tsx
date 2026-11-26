"use client";

import { useEffect } from "react";
import { resyncSubscription } from "@/client/push";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => {
          if (window.location.pathname !== "/login") {
            resyncSubscription().catch(() => {});
          }
        })
        .catch(() => {});
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
