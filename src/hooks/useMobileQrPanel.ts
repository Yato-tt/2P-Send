import { useCallback, useState } from 'react';

export function useMobileQrPanel(transitionMs = 150) {
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const toggle = useCallback(() => {
    if (expanded) {
      setRevealed(false);
      setTimeout(() => setExpanded(false), transitionMs);
    } else {
      setExpanded(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setRevealed(true)));
    }
  }, [expanded, transitionMs]);

  return { expanded, revealed, toggle };
}
