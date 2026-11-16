// Arrival QR code drawn from the code matrix with plain Views (no native SVG module needed). Rows are run-length
// merged so a typical code renders as a few hundred views.
import { memo, useMemo } from "react";
import { View } from "react-native";
import QRCode from "qrcode";

function QrCodeView({ value, size, label }: { value: string; size: number; label: string }) {
  const rows = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    const out: { y: number; runs: { x: number; w: number }[] }[] = [];
    for (let y = 0; y < count; y += 1) {
      const runs: { x: number; w: number }[] = [];
      let x = 0;
      while (x < count) {
        if (qr.modules.get(x, y)) {
          const start = x;
          while (x < count && qr.modules.get(x, y)) x += 1;
          runs.push({ x: start, w: x - start });
        } else x += 1;
      }
      out.push({ y, runs });
    }
    return { count, out };
  }, [value]);
  const quiet = 4;
  const cell = size / (rows.count + quiet * 2);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}
      style={{ width: size, height: size, backgroundColor: "#FFFFFF", position: "relative" }}>
      {rows.out.map((row) =>
        row.runs.map((run) => (
          <View key={`${row.y}-${run.x}`} style={{
            position: "absolute", left: (run.x + quiet) * cell, top: (row.y + quiet) * cell,
            width: run.w * cell + 0.5, height: cell + 0.5, backgroundColor: "#2E2E2E"
          }} />
        ))
      )}
    </View>
  );
}

export const QrCode = memo(QrCodeView);
