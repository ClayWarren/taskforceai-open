import { useEffect, useRef, useState } from 'react';

export function useMobileViewport(): boolean {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const updateViewport = () => {
      setIsMobileViewport(window.innerWidth <= 768);
    };

    const debouncedUpdate = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(updateViewport, 150);
    };

    updateViewport();
    window.addEventListener('resize', debouncedUpdate);

    return () => {
      window.removeEventListener('resize', debouncedUpdate);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return isMobileViewport;
}
