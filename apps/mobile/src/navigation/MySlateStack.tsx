import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { MySlateStackParamList } from "./types";
import { MySlateScreen } from "../screens/main/MySlateScreen";
import { TitleDetailScreen } from "../screens/main/TitleDetailScreen";
import { AskSlateScreen } from "../screens/main/AskSlateScreen";
import { ProUpgradeScreen } from "../screens/main/ProUpgradeScreen";
import { NewPostScreen } from "../screens/main/NewPostScreen";
import { PostDetailScreen } from "../screens/main/PostDetailScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<MySlateStackParamList>();

export function MySlateStack() {
  return (
    <Stack.Navigator
      screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}
    >
      <Stack.Screen name="MySlate" component={MySlateScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TitleDetail" component={TitleDetailScreen} options={{ title: "" }} />
      <Stack.Screen name="AskSlate" component={AskSlateScreen} options={{ title: "Ask Slate" }} />
      <Stack.Screen name="ProUpgrade" component={ProUpgradeScreen} options={{ title: "Slate Pro" }} />
      <Stack.Screen name="NewPost" component={NewPostScreen} options={{ title: "New post" }} />
      <Stack.Screen name="PostDetail" component={PostDetailScreen} options={{ title: "Post" }} />
    </Stack.Navigator>
  );
}
