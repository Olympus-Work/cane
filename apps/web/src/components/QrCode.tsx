import QRCode from 'qrcode';
import { useMemo } from 'react';

const QUIET = 4; // modules of white margin around the code (the QR spec asks for 4)

/**
 * A QR code as inline SVG, drawn from the module matrix (no canvas, no innerHTML, no network).
 * Always black on white so scanners work in both themes.
 */
export function QrCode({ value, label, size = 200 }: { value: string; label: string; size?: number }) {
  const { path, dim } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      }
    }
    return { path: d, dim: n + QUIET * 2 };
  }, [value]);

  return (
    <svg className="qr-code" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges">
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
