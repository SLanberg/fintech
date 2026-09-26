'use client';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { normalizeIban, validateIban } from '../../lib/iban';
import { availableTransferBalance, cancelHeldTransfer, completeTransfer, holdTransfer, paidIbans, releaseHeldTransfer, savePayee, scamBeneficiaries, simulateApproval, transferBalance, transferDemo } from '../../lib/transfer-demo';
import type { TransferState } from '../../lib/transfer-demo';
import { canReleaseHeldTransfer, contactKey, derivePaidPayees, evaluateTransfer, SCAM_EXPLANATIONS, TRANSFER_RULES, verifyPayee } from '../../lib/transfer-risk';
import type { HeldTransfer, Transfer, TransferContext, VerificationResult } from '../../lib/transfer-risk';
import settings from './SpendingSettings.module.css';
import purchase from './PurchaseSimulator.module.css';
import styles from './TransferProtection.module.css';

const QUESTIONS = [
  'Is someone on the phone or in a chat telling you to make this payment right now?',
  'Did someone ask you to move your money to a safe account?',
  'Did you find this investment or seller through a social media ad or a messenger?',
];
const BANK_WARNING = 'Your bank will never ask you to move money to a safe account.';
const VERIFICATION_TEXT: Record<VerificationResult, string> = {
  MATCH: 'The account holder name matches.',
  CLOSE_MATCH: 'The account holder name is only a close match. Check the name with the recipient.',
  NO_MATCH: 'The account holder name does not match. Check the recipient details.',
};
const money = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);
const date = (timestamp: number) => new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const countdown = (deadline: number, now: number) => {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
type Review = { transfer: Transfer; verification: VerificationResult; evaluation: ReturnType<typeof evaluateTransfer>; stage: 'ask' | 'review' | 'block'; answered: boolean };

export default function TransferProtection({ state, setState, ready, storageError, onBack, onSettings }: {
  state: TransferState; setState: Dispatch<SetStateAction<TransferState>>; ready: boolean; storageError: string | null; onBack: () => void; onSettings: () => void;
}) {
  const [recipientName, setRecipientName] = useState('');
  const [iban, setIban] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [instant, setInstant] = useState(true);
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [heldId, setHeldId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<(boolean | null)[]>([null, null, null]);
  const [reportSent, setReportSent] = useState(false);
  const [wallTime, setWallTime] = useState(() => Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const now = wallTime + state.clockOffset;
  const locked = !ready || !!storageError;
  const activeHold = state.held.find(item => item.transfer.id === heldId);
  const modalOpen = !!review || !!activeHold;
  useEffect(() => { const timer = setInterval(() => setWallTime(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (modalOpen && !dialog.current?.open) dialog.current?.showModal();
    else if (!modalOpen && dialog.current?.open) dialog.current?.close();
  }, [modalOpen]);
  function close() { setReview(null); setHeldId(null); }
  function context(verification: VerificationResult, askAnswers?: boolean[]): TransferContext {
    return { now: Date.now() + state.clockOffset, balance: transferBalance(state), previouslyPaidIbans: paidIbans(state), savedPayees: state.savedPayees, verification, scamBeneficiaries, amountThreshold: state.amountThreshold, askAnswers };
  }
  function mutate(operation: (current: TransferState) => TransferState): boolean {
    if (locked) return false;
    try { setState(operation(state)); return true; }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The transfer could not be updated.'); return false; }
  }
  function startHold(transfer: Transfer, reasons: string[]) {
    if (mutate(current => holdTransfer(current, transfer, reasons, Date.now() + current.clockOffset))) {
      setReview(null); setHeldId(transfer.id); setMessage('Transfer held as a standard payment. No money has been sent.');
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('');
    if (locked) return;
    const validation = validateIban(iban);
    if (!validation.valid) { setMessage(validation.error!); return; }
    const value = Number(amount);
    if (!recipientName.trim() || !Number.isFinite(value) || value <= 0 || Math.round(value * 100) / 100 !== value) { setMessage('Enter a recipient and a positive amount with at most two decimal places.'); return; }
    const transfer: Transfer = { id: crypto.randomUUID(), recipientName: recipientName.trim(), iban: validation.normalized, amount: value, reference: reference.trim(), instant };
    const verification = verifyPayee(transfer.iban, transfer.recipientName, transferDemo.directory);
    const evaluation = evaluateTransfer(transfer, context(verification));
    setReportSent(false); setAnswers([null, null, null]);
    // Reported beneficiaries take priority even when the amount exceeds the balance.
    if (evaluation.decision === 'BLOCK') { setReview({ transfer, verification, evaluation, stage: 'block', answered: false }); return; }
    if (value > availableTransferBalance(state)) { setMessage('Not enough available funds. Held transfers reserve their amount.'); return; }
    if (evaluation.decision === 'HOLD') { startHold(transfer, evaluation.reasons); return; }
    setReview({ transfer, verification, evaluation, stage: evaluation.decision === 'ASK' ? 'ask' : 'review', answered: false });
  }
  function answerQuestions() {
    if (!review || answers.some(answer => answer === null)) return;
    const evaluation = evaluateTransfer(review.transfer, context(review.verification, answers as boolean[]));
    if (evaluation.decision === 'HOLD') { startHold(review.transfer, [...evaluation.reasons, BANK_WARNING]); return; }
    if (evaluation.decision === 'BLOCK') { setReview({ ...review, evaluation, stage: 'block' }); return; }
    setReview({ ...review, evaluation, stage: 'review', answered: true });
  }
  function send() {
    if (!review || review.stage !== 'review') return;
    const evaluation = evaluateTransfer(review.transfer, context(review.verification, review.answered ? answers as boolean[] : undefined));
    if (evaluation.decision === 'BLOCK') { setReview({ ...review, evaluation, stage: 'block' }); return; }
    if (evaluation.decision === 'HOLD') { startHold(review.transfer, evaluation.reasons); return; }
    if (evaluation.decision === 'ASK' && !review.answered) { setReview({ ...review, evaluation, stage: 'ask' }); return; }
    if (mutate(current => completeTransfer(current, review.transfer, Date.now() + current.clockOffset))) { setMessage(`Demo transfer of ${money(review.transfer.amount)} sent to ${review.transfer.recipientName}.`); close(); setAmount(''); }
  }
  function cancel(held: HeldTransfer) {
    if (mutate(current => cancelHeldTransfer(current, held.transfer.id))) { setMessage('Held transfer cancelled. The reserved funds are available again.'); if (heldId === held.transfer.id) close(); }
  }
  function release(held: HeldTransfer) {
    if (mutate(current => releaseHeldTransfer(current, held.transfer.id, Date.now() + current.clockOffset))) { setMessage('Standard demo transfer sent.'); close(); }
  }
  function preset(tag: string, value: number, name?: string) {
    const merchant = transferDemo.directory.find(item => item.tag === tag)!;
    setRecipientName(name ?? merchant.accountHolder); setIban(merchant.iban); setAmount(String(value)); setReference(tag === 'landlord' ? 'Rent top-up' : tag === 'safe-account' ? 'Move money to safe account' : 'Demo transfer'); setInstant(true); setMessage('');
  }
  function holdControls(held: HeldTransfer) {
    const approved = !!state.trustedContact && held.approvedBy === contactKey(state.trustedContact);
    return <>
      <p className={styles.countdown} aria-label="Time remaining">{countdown(held.releaseAt, now)}</p>
      <p className={purchase.note}>Standard payment · {money(held.transfer.amount)} reserved · Release time {new Date(held.releaseAt).toLocaleString('en-GB')}</p>
      <ul className={styles.reasonList}>{held.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      {held.transfer.amount >= TRANSFER_RULES.trustedApprovalThreshold && <p className={purchase.note}>This amount also requires trusted contact approval, even after the countdown.</p>}
      <p className={purchase.note}>{approved ? `Simulated approval from ${state.trustedContact!.name} received for this transfer.` : 'Early release requires approval from your trusted contact.'}</p>
      {!state.trustedContact && <button type="button" onClick={() => { close(); onSettings(); }}>Add a trusted contact in Settings</button>}
      <div className={purchase.buttons}>
        <button type="button" disabled={locked} onClick={() => cancel(held)}>Cancel transfer</button>
        <button type="button" disabled={locked || !canReleaseHeldTransfer(held, now, state.trustedContact)} onClick={() => release(held)}>Release standard payment</button>
      </div>
      {process.env.NODE_ENV === 'development' && <details className={styles.demo}>
        <summary>Hold demo controls</summary>
        <button type="button" disabled={locked} onClick={() => {
          const timestamp = Date.now();
          if (mutate(current => ({ ...current, clockOffset: Math.max(current.clockOffset, held.releaseAt - timestamp) }))) setWallTime(timestamp);
        }}>Fast-forward hold</button>
        <button type="button" disabled={locked || !state.trustedContact} onClick={() => mutate(current => simulateApproval(current, held.transfer.id))}>Simulate trusted contact approval</button>
        <p className={purchase.note}>No SMS or other message is sent.</p>
      </details>}
    </>;
  }
  const scam = review?.stage === 'block' ? scamBeneficiaries.find(item => normalizeIban(item.iban) === normalizeIban(review.transfer.iban)) : undefined;
  return <section className={`${styles.screen} ${settings.screen}`}>
    <div className={styles.heading}><h1>New transfer</h1><button type="button" onClick={onBack}>Back</button></div>
    <div className={styles.account}>
      <span>{transferDemo.account.name}</span><strong>{money(transferBalance(state))}</strong>
      <span>Available {money(availableTransferBalance(state))} · Fictitious EUR transfers only</span>
      <p className={purchase.note}>This separate demo account lets you explore transfer protection. Payments here do not change your Safe to Spend account.</p>
    </div>
    {storageError && <p role="alert" className={purchase.warning}>{storageError}</p>}
    {message && <p role="status" className={styles.status}>{message}</p>}
    {process.env.NODE_ENV === 'development' && <details className={`${settings.panel} ${styles.demo}`}>
      <summary>Transfer demo scenarios</summary>
      <div className={purchase.buttons}>
        <button type="button" onClick={() => preset('landlord', 350)}>Rent · ALLOW</button>
        <button type="button" onClick={() => preset('safe-account', 2400, 'Bank Safe Account')}>Safe account · HOLD</button>
        <button type="button" onClick={() => preset('reported', 100)}>Reported scam · BLOCK</button>
        <button type="button" onClick={() => preset('new-payee', 600)}>New payee · ASK</button>
      </div>
      <p className={purchase.note}>Presets use the initial €3,000 balance and default threshold. Later payments or changed settings can change the outcome.</p>
      <button type="button" disabled={locked} onClick={() => { if (mutate(current => ({ ...current, completed: [], held: [], clockOffset: 0 }))) { close(); setMessage('Demo account history and holds reset. Settings and saved payees kept.'); } }}>Reset transfer demo account</button>
    </details>}
    <form className={settings.panel} onSubmit={submit}>
      <label>Recipient name<input value={recipientName} onChange={event => setRecipientName(event.target.value)} maxLength={80} required disabled={locked} /></label>
      <label>IBAN<input value={iban} onChange={event => setIban(event.target.value)} autoCapitalize="characters" autoComplete="off" required disabled={locked} /></label>
      <label>Amount (EUR)<input type="number" value={amount} onChange={event => setAmount(event.target.value)} min="0.01" step="0.01" required disabled={locked} /></label>
      <label>Reference<input value={reference} onChange={event => setReference(event.target.value)} maxLength={140} disabled={locked} /></label>
      <label className={styles.toggle}><input type="checkbox" checked={instant} onChange={event => setInstant(event.target.checked)} disabled={locked} />Instant payment</label>
      <div className={purchase.buttons}>
        <button type="submit" disabled={locked}>Review transfer</button>
        <button type="button" disabled={locked} onClick={() => { if (mutate(current => savePayee(current, recipientName, iban, Date.now() + current.clockOffset))) setMessage('Payee saved. Saving a payee does not count as having paid them before.'); }}>Save payee</button>
      </div>
    </form>
    {state.held.length > 0 && <section className={settings.panel}>
      <h2>Held transfers</h2>
      {state.held.map(held => <article key={held.transfer.id} className={styles.payee}>
        <strong>{held.transfer.recipientName} · {money(held.transfer.amount)}</strong>
        <span>Standard payment · {countdown(held.releaseAt, now)} remaining</span>
        <div className={purchase.buttons}><button type="button" onClick={() => { setReview(null); setHeldId(held.transfer.id); }}>Review hold</button><button type="button" disabled={locked} onClick={() => cancel(held)}>Cancel transfer</button></div>
      </article>)}
    </section>}
    <section className={settings.panel}><h2>Saved payees</h2>
      {state.savedPayees.map(payee => <article key={payee.iban} className={styles.payee}>
        <strong>{payee.name}</strong><span>{payee.iban}</span><span>Added {date(payee.addedAt)}</span>
        <button type="button" onClick={() => { setRecipientName(payee.name); setIban(payee.iban); }}>Use payee</button>
      </article>)}
    </section>
    <section className={settings.panel}><h2>Previously paid recipients</h2>
      <p className={purchase.note}>Derived from mock transaction history and completed demo transfers.</p>
      {derivePaidPayees([...transferDemo.history, ...state.completed]).map(payee => <article key={payee.iban} className={styles.payee}>
        <strong>{payee.name}</strong><span>{payee.iban} · First paid {date(payee.addedAt)}</span>
        <button type="button" onClick={() => { setRecipientName(payee.name); setIban(payee.iban); }}>Use recipient</button>
      </article>)}
    </section>
    <dialog ref={dialog} className={`${purchase.dialog} ${styles.dialog}`} aria-labelledby="transfer-dialog-title" onCancel={close}>
      <div className={purchase.eyebrow}>Transfer protection · simulated bank confirmation</div>
      {activeHold ? <>
        <h2 id="transfer-dialog-title">Payment held for cooling-off</h2>
        <strong>{activeHold.transfer.recipientName} · {money(activeHold.transfer.amount)}</strong>
        <p className={styles.details}>{activeHold.transfer.iban}</p>
        <p className={purchase.note}>{VERIFICATION_TEXT[verifyPayee(activeHold.transfer.iban, activeHold.transfer.recipientName, transferDemo.directory)]}</p>
        {holdControls(activeHold)}
        <button type="button" onClick={close}>Back to transfers</button>
      </> : review && <>
        <h2 id="transfer-dialog-title">{review.stage === 'block' ? 'Transfer blocked' : review.stage === 'ask' ? 'A moment to check' : 'Confirm transfer'}</h2>
        <div className={purchase.merchant}><strong>{review.transfer.recipientName}</strong><span>{money(review.transfer.amount)}</span></div>
        <p className={styles.details}>{review.transfer.iban}<br />{review.transfer.instant ? 'Instant payment' : 'Standard payment'}{review.transfer.reference && <><br />Reference: {review.transfer.reference}</>}</p>
        <p className={purchase.note}>Verification of Payee: {review.verification}<br />{VERIFICATION_TEXT[review.verification]}</p>
        {review.stage === 'block' && scam ? <>
          <div className={styles.blocked}><strong>This recipient is linked to a reported {scam.scamType}.</strong><p>{SCAM_EXPLANATIONS[scam.scamType]}</p><p>Reported {scam.dateReported} · {scam.sourceLabel}</p></div>
          <p className={purchase.note}>This is a fictitious demo report. You cannot proceed with this transfer.</p>
          {reportSent && <p role="status" className={styles.status}>Demo report recorded. No report or message was sent.</p>}
          <div className={purchase.buttons}><button type="button" disabled={reportSent} onClick={() => setReportSent(true)}>Report</button><button type="button" onClick={close}>Back</button></div>
        </> : <>
          {review.evaluation.reasons.length > 0 && <div className={purchase.nudge}><h3>Payment checks</h3><ul>{review.evaluation.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
          {review.stage === 'ask' ? <>
            {QUESTIONS.map((question, index) => <fieldset key={question} className={styles.question}><legend>{question}</legend>
              <div className={styles.answers}>{[true, false].map(value => <label key={String(value)}><input type="radio" name={`question-${index}`} checked={answers[index] === value} onChange={() => setAnswers(current => current.map((answer, i) => i === index ? value : answer))} />{value ? 'Yes' : 'No'}</label>)}</div>
            </fieldset>)}
            <div className={purchase.buttons}><button type="button" disabled={locked || answers.some(answer => answer === null)} onClick={answerQuestions}>Continue</button><button type="button" onClick={close}>Cancel</button></div>
          </> : <>
            {review.answered && <p className={styles.status}>{BANK_WARNING}</p>}
            <p className={purchase.note}>Available after this transfer: {money(availableTransferBalance(state) - review.transfer.amount)}.</p>
            <div className={purchase.buttons}><button type="button" disabled={locked} onClick={send}>Confirm transfer</button><button type="button" onClick={close}>Cancel</button></div>
          </>}
        </>}
      </>}
    </dialog>
  </section>;
}
