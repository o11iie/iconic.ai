import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { SearchStackParamList } from "./types";
import { SearchScreen } from "../screens/main/SearchScreen";
import { TitleDetailScreen } from "../screens/main/TitleDetailScreen";
import { AskSlateScreen } from "../screens/main/AskSlateScreen";
import { ProUpgradeScreen } from "../screens/main/ProUpgradeScreen";
import { NewPostScreen } from "../screens/main/NewPostScreen";
import { PostDetailScreen } from "../screens/main/PostDetailScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<SearchStackParamList>();

const screenOptions = {
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.text,
};

export function SearchStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Search" component={SearchScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TitleDetail" component={TitleDetailScreen} options={{ title: "" }} />
      <Stack.Screen name="AskSlate" component={AskSlateScreen} options={{ title: "Ask Slate" }} />
      <Stack.Screen name="ProUpgrade" component={ProUpgradeScreen} options={{ title: "Slate Pro" }} />
      <Stack.Screen name="NewPost" component={NewPostScreen} options={{ title: "New Post" }} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: "Post" }} />
    </Stack.Navigator>
  );
}
