import { CameraView, useCameraPermissions, type BarcodeType } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DEMO } from "../lib/config";
import { colors } from "../lib/theme";
import { Button } from "./Button";

type Props = {
  barcodeTypes: BarcodeType[];
  onCode: (code: string) => void;
  /** Stop reporting while, e.g., a product preview is open. */
  paused?: boolean;
  manualLabel: string;
  manualPlaceholder: string;
  /** Demo builds have no camera: these stand in for codes the shopper would scan. */
  demoPicks?: { code: string; label: string; sub?: string }[];
  demoTitle?: string;
};

/** Ignore the same code for this long, so a pack held in view is reported once, not every frame. */
const REPEAT_AFTER_MS = 3000;

/**
 * Camera barcode scanner with a typed-in fallback for emulators, a denied permission, or a
 * label that won't scan.
 */
export function ScannerView({ barcodeTypes, onCode, paused, manualLabel, manualPlaceholder, demoPicks, demoTitle }: Props) {
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
      {DEMO && demoPicks ? (
        <View style={styles.demo}>
          <Text style={styles.demoTitle}>{demoTitle ?? "Tap to scan"}</Text>
          <Text style={styles.demoNote}>On a phone, the camera scans here. In this demo, tap one instead.</Text>
          <ScrollView contentContainerStyle={styles.demoGrid}>
            {demoPicks.map((p) => (
              <Pressable
                key={p.code}
                accessibilityRole="button"
                disabled={paused}
                onPress={() => onCode(p.code)}
                style={({ pressed }) => [styles.demoPick, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.demoPickLabel}>{p.label}</Text>
                {p.sub && <Text style={styles.demoPickSub}>{p.sub}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : (
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
      )}
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
  demo: { flex: 1, backgroundColor: colors.brandSoft, padding: 16, gap: 6 },
  demoTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  demoNote: { fontSize: 13, color: colors.muted },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 6 },
  demoPick: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, minWidth: "46%", flexGrow: 1 },
  demoPickLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  demoPickSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
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
