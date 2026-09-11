import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { WatchlistStackParamList } from "./types";
import { WatchlistScreen } from "../screens/main/WatchlistScreen";
import { TitleDetailScreen } from "../screens/main/TitleDetailScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<WatchlistStackParamList>();

export function WatchlistStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}>
      <Stack.Screen name="Watchlist" component={WatchlistScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TitleDetail" component={TitleDetailScreen} options={{ title: "" }} />
    </Stack.Navigator>
  );
}
