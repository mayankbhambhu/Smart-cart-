import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { colors } from "../lib/theme";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = "primary", disabled, busy, style }: Props) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "secondary" ? colors.brand : "#fff"} />
      ) : (
        <Text style={[styles.label, variant === "secondary" && styles.secondaryLabel]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.brandSoft },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryLabel: { color: colors.brand },
});
