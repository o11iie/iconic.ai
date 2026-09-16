import React, { useEffect } from "react";
import { AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/state/AuthContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { initIap } from "./src/billing/iap";
import { flushAnalytics, track } from "./src/analytics/analytics";

export default function App() {
  useEffect(() => {
    initIap().catch(() => undefined);
    track("app_open");
  }, []);

  useEffect(() => {
    // Analytics batch on a 10-second timer, so without this up to ten seconds
    // of events are lost every time the app is backgrounded or killed — and
    // purchase_completed is usually the last thing that happens before a user
    // leaves, which is exactly the event the conversion funnel depends on.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        flushAnalytics().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
