import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

/** Mobile shows only Dashboard and Kill switch (spec B16.10), with a compact Dashboard (spec 2d). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
