import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";

interface EntitlementState {
  status: string;
  isActive: boolean;
  expiresAt: string | null;
}

interface EntitlementContextValue {
  entitlement: EntitlementState;
  refresh: () => Promise<void>;
}

const defaultState: EntitlementState = { status: "NONE", isActive: false, expiresAt: null };

const EntitlementContext = createContext<EntitlementContextValue>({ entitlement: defaultState, refresh: async () => {} });

/**
 * The ONLY place mobile code learns whether the current user is Pro.
 * This always reflects the backend's verified entitlement — never a
 * locally-set flag — and is refetched on login/logout so switching
 * accounts on one device can't leak another user's Pro status.
 */
export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [entitlement, setEntitlement] = useState<EntitlementState>(defaultState);

  const refresh = useCallback(async () => {
    if (!user) {
      setEntitlement(defaultState);
      return;
    }
    try {
      const res = await api.get<EntitlementState>("/billing/entitlement");
      setEntitlement(res);
    } catch {
      setEntitlement(defaultState);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <EntitlementContext.Provider value={{ entitlement, refresh }}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement() {
  return useContext(EntitlementContext);
}
