import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { ProfileStackParamList } from "./types";
import { ProfileScreen } from "../screens/main/ProfileScreen";
import { ProUpgradeScreen } from "../screens/main/ProUpgradeScreen";
import { SettingsScreen } from "../screens/main/SettingsScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}>
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ProUpgrade" component={ProUpgradeScreen} options={{ title: "Slate Pro" }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
    </Stack.Navigator>
  );
}
