'use client';
import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import type { TransferState } from '../../lib/transfer-demo';
import { validTrustedContact } from '../../lib/transfer-risk';
import styles from './SpendingSettings.module.css';

export default function TransferSettings({ state, setState, disabled }: { state: TransferState; setState: Dispatch<SetStateAction<TransferState>>; disabled: boolean }) {
  const [message, setMessage] = useState('');
  return <section className={styles.screen} aria-label="Transfer protection settings">
    <form className={styles.panel} onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const name = String(data.get('contactName') ?? '').trim(), phone = String(data.get('phone') ?? '').trim();
      const amountThreshold = Number(data.get('threshold')), holdHours = Number(data.get('holdHours'));
      if (!!name !== !!phone || (phone && !validTrustedContact({ name, phone }))) { setMessage('Enter both a name and a valid phone number, or leave both blank.'); return; }
      if (!Number.isFinite(amountThreshold) || amountThreshold <= 0 || !Number.isFinite(holdHours) || holdHours <= 0 || holdHours > 168) return;
      setState(current => ({ ...current, trustedContact: name ? { name, phone } : null, amountThreshold, holdHours, held: current.held.map(item => ({ ...item, approvedBy: null })) }));
      setMessage('Transfer settings saved. Existing hold deadlines stay the same; any previous contact approvals must be renewed.');
    }}>
      <h2>Transfer protection</h2>
      <p className={styles.note}>Add one trusted contact. Approval is required to release any hold early, and to release held transfers of €1,000 or more after the countdown. All approvals in this demo are simulated; no messages are sent.</p>
      <label>Trusted contact name<input name="contactName" defaultValue={state.trustedContact?.name ?? ''} maxLength={80} disabled={disabled} /></label>
      <label>Trusted contact phone<input name="phone" type="tel" defaultValue={state.trustedContact?.phone ?? ''} disabled={disabled} /></label>
      <div className={styles.row}>
        <label>Amount threshold (EUR)<input name="threshold" type="number" min="0.01" step="0.01" defaultValue={state.amountThreshold} required disabled={disabled} /></label>
        <label>Cooling-off period (hours)<input name="holdHours" type="number" min="0.01" max="168" step="0.01" defaultValue={state.holdHours} required disabled={disabled} /></label>
      </div>
      <button type="submit" disabled={disabled}>Save transfer settings</button>
      {message && <p role="status" className={styles.note}>{message}</p>}
    </form>
  </section>;
}
