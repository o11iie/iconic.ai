import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { SearchStackParamList } from "./types";
import { SearchScreen } from "../screens/main/SearchScreen";
import { TitleDetailScreen } from "../screens/main/TitleDetailScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<SearchStackParamList>();

export function SearchStack() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}>
      <Stack.Screen name="Search" component={SearchScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TitleDetail" component={TitleDetailScreen} options={{ title: "" }} />
    </Stack.Navigator>
  );
}
