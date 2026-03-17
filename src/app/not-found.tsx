'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(2);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          router.replace('/flows/agents');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <html>
      <body>
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
      </body>
    </html>
  );
}
