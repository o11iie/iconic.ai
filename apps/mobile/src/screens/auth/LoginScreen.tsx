import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../../state/AuthContext";
import { colors } from "../../theme";
import type { AuthStackParamList } from "../../navigation/types";
import { ApiError } from "../../api/client";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Slate</Text>
      <Text style={styles.subtitle}>The home of entertainment hype.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={isSubmitting}
            accessibilityRole="button"
          >
        {isSubmitting ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Log In</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Signup")}
            accessibilityRole="button"
          >
        <Text style={styles.link}>New to Slate? Create an account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: 24 },
  title: { color: colors.text, fontSize: 40, fontWeight: "800", textAlign: "center" },
  subtitle: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 6, marginBottom: 36 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    color: colors.text,
    marginBottom: 12,
  },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#000", fontWeight: "700", fontSize: 16 },
  link: { color: colors.textMuted, textAlign: "center", marginTop: 20 },
  error: { color: colors.accent, marginBottom: 8 },
});
