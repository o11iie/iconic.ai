import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAuth } from "../../state/AuthContext";
import { colors } from "../../theme";
import type { AuthStackParamList } from "../../navigation/types";
import { ApiError } from "../../api/client";

type Props = NativeStackScreenProps<AuthStackParamList, "Signup">;

export function SignupScreen({ navigation }: Props) {
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await signup(email.trim().toLowerCase(), password, handle.trim().toLowerCase(), displayName.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>

      <TextInput style={styles.input} placeholder="Display name" placeholderTextColor={colors.textMuted} value={displayName} onChangeText={setDisplayName} />
      <TextInput style={styles.input} placeholder="Handle (e.g. moviefan92)" placeholderTextColor={colors.textMuted} autoCapitalize="none" value={handle} onChangeText={setHandle} />
      <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textMuted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput style={styles.input} placeholder="Password (min 8 characters)" placeholderTextColor={colors.textMuted} secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={isSubmitting}
            accessibilityRole="button"
          >
        {isSubmitting ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Create Account</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Login")}
            accessibilityRole="button"
          >
        <Text style={styles.link}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: 24 },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", textAlign: "center", marginBottom: 28 },
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
