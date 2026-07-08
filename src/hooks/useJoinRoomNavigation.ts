import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export function useJoinRoomNavigation() {
  const [code, setCode] = useState('');

  const join = useCallback(() => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) {
      toast.error('Digite o código da sala.');
      return;
    }
    window.location.href = `/sala/${encodeURIComponent(trimmed)}`;
  }, [code]);

  return { code, setCode, join };
}
