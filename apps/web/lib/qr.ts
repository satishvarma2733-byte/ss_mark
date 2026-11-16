// Server-side QR rendering for the booking page: an SVG path built from the code matrix (no image files, no network).
import QRCode from "qrcode";

export function qrSvg(text: string, label: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 4;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(x, y)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const view = size + quiet * 2;
  const safeLabel = label.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" role="img" aria-label="${safeLabel}" shape-rendering="crispEdges"><rect width="${view}" height="${view}" fill="#ffffff"/><path d="${path}" fill="#2e2e2e"/></svg>`;
}
