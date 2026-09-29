'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { X } from 'lucide-react';
function subscribe(callback: () => void) {
  const media = window.matchMedia('(max-width:700px)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
export default function PlannerPanel({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
}) {
  const mobile = useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(max-width:700px)').matches,
    () => false,
  );
  if (!mobile) return <aside className="planner-panel">{children}</aside>;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mobile-planner-sheet"
        showCloseButton={false}
      >
        <div className="planner-sheet-header">
          <SheetTitle>Параметри прогулянки</SheetTitle>
          <SheetClose className="icon-button" aria-label="Закрити параметри">
            <X size={20} />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">
          Довжина, старт, спосіб побудови та повернення.
        </SheetDescription>
        <div className="planner-panel">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
