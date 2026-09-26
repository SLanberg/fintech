'use client';
import { useEffect, useState } from 'react';
import { initialTransferState, restoreTransferState } from './transfer-demo';

const KEY = 'fintech-transfer-protection-v1';
export function useTransferState() {
  const [state, setState] = useState(initialTransferState);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try { const raw = localStorage.getItem(KEY); if (raw) setState(restoreTransferState(raw)); }
      catch { setStorageError('Saved transfer data could not be loaded. Transfers are disabled to avoid losing a saved hold.'); }
      setReady(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready || storageError) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { Promise.resolve().then(() => setStorageError('Transfer data could not be saved. Transfers are disabled until browser storage is available.')); }
  }, [state, ready, storageError]);
  return { state, setState, ready, storageError };
}
