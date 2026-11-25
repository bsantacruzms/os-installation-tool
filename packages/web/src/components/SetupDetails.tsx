import { useId, useRef, type ReactNode } from 'react';
import { Button } from './ui.tsx';

/** Keep the browser walkthrough inline, but move secondary desktop controls into a dialog. */
export function SetupDetails({ compact, title, children }: { compact: boolean; title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  if (!compact) return <>{children}</>;
  return <>
    <Button onClick={() => dialog.current?.showModal()}>{title}</Button>
    <dialog ref={dialog} aria-labelledby={heading} className="setup-dialog">
      <div className="dialog-toolbar"><h2 id={heading}>{title}</h2><Button onClick={() => dialog.current?.close()}>Done</Button></div>
      <div className="dialog-content">{children}</div>
    </dialog>
  </>;
}
