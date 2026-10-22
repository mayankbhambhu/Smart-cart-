import { CameraView, useCameraPermissions, type BarcodeType } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../lib/theme";
import { Button } from "./Button";

type Props = {
  barcodeTypes: BarcodeType[];
  onCode: (code: string) => void;
  /** Stop reporting while, e.g., a product preview is open. */
  paused?: boolean;
  manualLabel: string;
  manualPlaceholder: string;
};

/** Ignore the same code for this long, so a pack held in view is reported once, not every frame. */
const REPEAT_AFTER_MS = 3000;

/**
 * Camera barcode scanner with a typed-in fallback for emulators, a denied permission, or a
 * label that won't scan.
 */
export function ScannerView({ barcodeTypes, onCode, paused, manualLabel, manualPlaceholder }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const last = useRef<{ code: string; at: number } | null>(null);
  const [manual, setManual] = useState("");

  const report = (code: string) => {
    if (paused) return;
    const now = Date.now();
    if (last.current && last.current.code === code && now - last.current.at < REPEAT_AFTER_MS) return;
    last.current = { code, at: now };
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onCode(code);
  };

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    setManual("");
    onCode(code);
  };

  return (
    <View style={styles.container}>
      <View style={styles.camera}>
        {permission?.granted ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes }}
              onBarcodeScanned={paused ? undefined : (r) => report(r.data)}
            />
            <View pointerEvents="none" style={styles.overlay}>
              <View style={styles.frame} />
            </View>
          </>
        ) : (
          <View style={styles.permission}>
            <Text style={styles.permissionText}>
              {permission && !permission.canAskAgain
                ? "Camera access is off for Smart Cart. Turn it on in Settings, or type the code below."
                : "Smart Cart uses the camera to scan cart QR codes and product barcodes."}
            </Text>
            {(!permission || permission.canAskAgain) && (
              <Button title="Allow camera" onPress={() => void requestPermission()} style={{ marginTop: 16 }} />
            )}
          </View>
        )}
      </View>
      <View style={styles.manual}>
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder={manualPlaceholder}
          accessibilityLabel={manualLabel}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={submitManual}
          style={styles.input}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Submit code" onPress={submitManual} style={styles.go}>
          <Text style={styles.goText}>Go</Text>
        </Pressable>
      </View>
      <Text style={styles.manualLabel}>{manualLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  frame: { width: 260, height: 160, borderWidth: 3, borderColor: "#fff", borderRadius: 16 },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  permissionText: { color: "#fff", textAlign: "center", fontSize: 15 },
  manual: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 16,
    backgroundColor: colors.surface,
  },
  go: { backgroundColor: colors.brandSoft, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  goText: { color: colors.brand, fontWeight: "600", fontSize: 16 },
  manualLabel: { color: colors.muted, fontSize: 12, paddingHorizontal: 16, paddingTop: 4 },
});
