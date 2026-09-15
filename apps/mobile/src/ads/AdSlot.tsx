import React from "react";
import { useEntitlement } from "../state/EntitlementContext";
import { adProvider, type AdPlacement } from "./AdProvider";

/**
 * The only way an ad reaches the screen. Pro suppression is enforced here,
 * once, rather than trusted to each call site remembering to check — and it
 * reads the backend-verified entitlement, never a local flag.
 */
export function AdSlot({ placement }: { placement: AdPlacement }) {
  const { entitlement } = useEntitlement();

  // Pro users are ad-free. This check comes first and is non-negotiable.
  if (entitlement.isActive) return null;
  if (!adProvider.canShow(placement)) return null;

  // When a real provider is wired up, its banner component renders here.
  return null;
}
