'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
      <SheetContent side="bottom" className="mobile-planner-sheet">
        <SheetTitle className="sr-only">Планування прогулянки</SheetTitle>
        <SheetDescription className="sr-only">
          Старт, режими маршруту та денна ціль
        </SheetDescription>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="planner-panel">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
