import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/hooks/useConfirm';
import { appRoutes } from '@/routes';
import { StoreProvider } from '@/store/StoreProvider';

export default function App(): React.JSX.Element {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <StoreProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
            <Toaster richColors closeButton position="top-right" />
          </ConfirmProvider>
        </TooltipProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
