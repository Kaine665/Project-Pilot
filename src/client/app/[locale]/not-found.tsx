'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'zh';
  const [countdown, setCountdown] = useState(2);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          router.replace(`/${locale}/workspace/agents`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [router, locale]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold text-muted-foreground">404</h1>
      <p className="text-muted-foreground">
        页面未找到，{countdown} 秒后跳转...
      </p>
    </div>
  );
}
