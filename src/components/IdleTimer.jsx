import { useEffect } from 'react';

export default function IdleTimer({ user, onTimeout, timeoutMinutes = 15 }) {
  useEffect(() => {
    if (!user) return;

    let timeoutId;
    const TIME_OUT_MS = timeoutMinutes * 60 * 1000;

    const handleTimeout = () => {
      if (onTimeout) onTimeout();
    };

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleTimeout, TIME_OUT_MS);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
    resetTimeout(); // Inizializza il timer
    
    events.forEach(event => window.addEventListener(event, resetTimeout));

    return () => {
      clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, resetTimeout));
    };
  }, [user, onTimeout, timeoutMinutes]);

  return null;
}