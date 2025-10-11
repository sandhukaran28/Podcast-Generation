'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import Dashboard from '@/features/dashboard/Dashboard';
import { useRouter } from 'next/navigation';

export default function HomeClient() {
  const { token, ready, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
  }, [ready, token, router]);

  if (!ready || !token) return null;
  return <Dashboard token={token} onLogout={logout} />;
}
