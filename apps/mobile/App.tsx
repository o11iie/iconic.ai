import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/state/AuthContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { initIap } from "./src/billing/iap";
import { track } from "./src/analytics/analytics";

export default function App() {
  useEffect(() => {
    initIap().catch(() => undefined);
    track("app_open");
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
