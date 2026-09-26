"use client";
import { useEffect, useState } from 'react';
import { defaultSpendingState, restoreSpendingState } from './spending-settings';

const STORAGE_KEY = 'fintech.safe-spend.v2';
export function useSpendingState() {
  const [state, setState] = useState(defaultSpendingState);
  const [ready, setReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try { setState(restoreSpendingState(localStorage.getItem(STORAGE_KEY))); }
      catch { setStorageUnavailable(true); }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { Promise.resolve().then(() => setStorageUnavailable(true)); }
  }, [state, ready]);
  return { state, setState, ready, storageUnavailable };
}
