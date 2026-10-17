import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { ToastProvider } from '@/components/common';
import { AdminAuthProvider } from '@/contexts/AdminAuthContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { VisitSessionProvider } from '@/contexts/VisitSessionContext';
import { queryClient } from './queryClient';
import { router } from './router';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <AdminAuthProvider>
            <VisitSessionProvider>
              <RouterProvider router={router} />
            </VisitSessionProvider>
          </AdminAuthProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
