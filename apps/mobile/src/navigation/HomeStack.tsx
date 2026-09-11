import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "./types";
import { HomeScreen } from "../screens/main/HomeScreen";
import { TitleDetailScreen } from "../screens/main/TitleDetailScreen";
import { AskSlateScreen } from "../screens/main/AskSlateScreen";
import { ProUpgradeScreen } from "../screens/main/ProUpgradeScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<HomeStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text },
};

export function HomeStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TitleDetail" component={TitleDetailScreen} options={{ title: "" }} />
      <Stack.Screen name="AskSlate" component={AskSlateScreen} options={{ title: "Ask Slate" }} />
      <Stack.Screen name="ProUpgrade" component={ProUpgradeScreen} options={{ title: "Slate Pro" }} />
    </Stack.Navigator>
  );
}
