import { cleanup, render, screen } from '@testing-library/react';
import QRCode from 'qrcode';
import { afterEach, describe, expect, it } from 'vitest';
import { QrCode } from '../src/components/QrCode';

const URI = 'otpauth://totp/Cane:owner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Cane';

describe('QrCode', () => {
  afterEach(cleanup);

  it('draws exactly the dark modules of the QR matrix, with a 4-module white margin', () => {
    render(<QrCode value={URI} label="qr" />);
    const svg = screen.getByRole('img', { name: 'qr' });
    const qr = QRCode.create(URI, { errorCorrectionLevel: 'M' });
    let dark = 0;
    for (let r = 0; r < qr.modules.size; r++) for (let c = 0; c < qr.modules.size; c++) if (qr.modules.get(r, c)) dark++;
    const path = svg.querySelector('path')?.getAttribute('d') ?? '';
    expect(path.match(/M/g)?.length).toBe(dark);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${qr.modules.size + 8} ${qr.modules.size + 8}`);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
  });

  it('a different value gives a different code', () => {
    const a = render(<QrCode value={URI} label="a" />);
    const pathA = a.container.querySelector('path')?.getAttribute('d');
    cleanup();
    const b = render(<QrCode value={URI.replace('JBSWY3DPEHPK3PXP', 'KRSXG5CTMVRXEZLU')} label="b" />);
    expect(b.container.querySelector('path')?.getAttribute('d')).not.toBe(pathA);
  });
});
