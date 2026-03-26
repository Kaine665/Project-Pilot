'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(2);

  useEffect(() => {
    if (countdown <= 0) {
      router.replace('/flows/agents');
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown(prev => Math.max(prev - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown, router]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#71717a',
      backgroundColor: '#fafafa',
    }}>
      <h1 style={{ fontSize: '4rem', fontWeight: 700, color: '#18181b', margin: 0 }}>404</h1>
      <p style={{ fontSize: '1rem', marginTop: '0.5rem' }}>
        页面未找到，{countdown} 秒后跳转到 Agents...
      </p>
    </div>
  );
}
