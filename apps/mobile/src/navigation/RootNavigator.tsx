import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../state/AuthContext";
import { EntitlementProvider } from "../state/EntitlementContext";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { SignupScreen } from "../screens/auth/SignupScreen";
import { HomeStack } from "./HomeStack";
import { MySlateStack } from "./MySlateStack";
import { SearchStack } from "./SearchStack";
import { WatchlistStack } from "./WatchlistStack";
import { ProfileStack } from "./ProfileStack";
import type { AuthStackParamList, MainTabParamList } from "./types";
import { colors } from "../theme";

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} options={{ title: "Discover" }} />
      <Tab.Screen name="MySlateTab" component={MySlateStack} options={{ title: "My Slate" }} />
      <Tab.Screen name="SearchTab" component={SearchStack} options={{ title: "Search" }} />
      <Tab.Screen name="WatchlistTab" component={WatchlistStack} options={{ title: "Watchlist" }} />
      <Tab.Screen name="ProfileTab" component={ProfileStack} options={{ title: "Profile" }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {user ? (
        <EntitlementProvider>
          <MainTabs />
        </EntitlementProvider>
      ) : (
        <AuthNavigator />
      )}
    </NavigationContainer>
  );
}
