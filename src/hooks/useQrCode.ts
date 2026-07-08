import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function useQrCode(value: string | null, size = 320) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) {
      setDataUrl(null);
      setVisible(false);
      return;
    }

    let cancelled = false;
    setVisible(false);

    QRCode.toDataURL(value, { width: size, color: { dark: '#18181b', light: '#ffffff' } })
      .then((url) => {
        if (cancelled) return;
        setDataUrl(url);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!cancelled) setVisible(true);
        }));
      })
      .catch((err) => console.error('Erro ao gerar QR code:', err));

    return () => { cancelled = true; };
  }, [value, size]);

  return { dataUrl, visible };
}
