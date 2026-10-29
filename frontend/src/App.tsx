import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/hooks/useConfirm';
import { StoreProvider } from '@/store/StoreProvider';

/** Provider shell only; routing arrives in a later task. */
export default function App(): React.JSX.Element {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <StoreProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <Toaster richColors closeButton position="top-right" />
          </ConfirmProvider>
        </TooltipProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
