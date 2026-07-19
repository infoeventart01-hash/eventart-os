"use client";

import { useCallback, useState } from "react";

type Confirmation = {
  title: string;
  name?: string;
  body?: string;
  confirmLabel?: string;
  resolve: (accepted: boolean) => void;
};

export function useConfirmDialog() {
  const [request, setRequest] = useState<Confirmation | null>(null);

  const confirm = useCallback((options: Omit<Confirmation, "resolve">) => new Promise<boolean>(resolve => {
    setRequest({ ...options, resolve });
  }), []);

  const finish = useCallback((accepted: boolean) => {
    setRequest(current => {
      current?.resolve(accepted);
      return null;
    });
  }, []);

  const dialog = request ? <div className="confirm-dialog" role="presentation">
    <button className="confirm-dialog-scrim" aria-label="Cancel deletion" onClick={() => finish(false)} />
    <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-body">
      <p className="eyebrow">CONFIRM ACTION</p>
      <h2 id="confirm-dialog-title">{request.title}</h2>
      {request.name && <strong>{request.name}</strong>}
      <p id="confirm-dialog-body">{request.body || "This action cannot be undone."}</p>
      <footer><button type="button" onClick={() => finish(false)}>Cancel</button><button type="button" className="danger destructive" onClick={() => finish(true)}>{request.confirmLabel || "Delete"}</button></footer>
    </section>
  </div> : null;

  return { confirm, dialog };
}

