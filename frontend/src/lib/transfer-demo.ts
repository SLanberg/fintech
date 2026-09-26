import demo from '../../../data/transfer_demo.json' with { type: 'json' };
import registry from '../../../data/scam_ibans.json' with { type: 'json' };
import { normalizeIban, validateIban } from './iban.ts';
import { canReleaseHeldTransfer, contactKey, derivePaidPayees, TRANSFER_RULES, validTrustedContact } from './transfer-risk.ts';
import type { HeldTransfer, PaidTransfer, SavedPayee, ScamBeneficiary, Transfer, TrustedContact } from './transfer-risk.ts';

export const transferDemo = demo;
export const scamBeneficiaries = registry.entries as ScamBeneficiary[];
export interface TransferState {
  trustedContact: TrustedContact | null;
  savedPayees: SavedPayee[];
  completed: PaidTransfer[];
  held: HeldTransfer[];
  clockOffset: number;
  amountThreshold: number;
  holdHours: number;
}
export function initialTransferState(): TransferState {
  return { trustedContact: null, savedPayees: derivePaidPayees(demo.history), completed: [], held: [], clockOffset: 0, amountThreshold: TRANSFER_RULES.amountThreshold, holdHours: TRANSFER_RULES.holdMs / 3600000 };
}
export const transferBalance = (state: TransferState) => Math.round((demo.account.balance - state.completed.reduce((total, item) => total + item.amount, 0)) * 100) / 100;
export const availableTransferBalance = (state: TransferState) => Math.round((transferBalance(state) - state.held.reduce((total, item) => total + item.transfer.amount, 0)) * 100) / 100;
export const paidIbans = (state: TransferState) => [...demo.history, ...state.completed].map(item => item.iban);
const reported = (transfer: Transfer) => scamBeneficiaries.some(entry => normalizeIban(entry.iban) === normalizeIban(transfer.iban));
const validTransfer = (transfer: Transfer) => !!transfer.id && !!transfer.recipientName.trim() && validateIban(transfer.iban).valid && Number.isFinite(transfer.amount) && transfer.amount > 0 && Math.round(transfer.amount * 100) / 100 === transfer.amount;
function checkNewTransfer(state: TransferState, transfer: Transfer) {
  if (!validTransfer(transfer) || reported(transfer)) throw new Error('This recipient or transfer cannot be paid.');
  if (state.completed.some(item => item.id === transfer.id) || state.held.some(item => item.transfer.id === transfer.id)) throw new Error('This transfer has already been recorded.');
  if (transfer.amount > availableTransferBalance(state)) throw new Error('Not enough available funds. Held transfers reserve their amount.');
}
/** State transitions are pure. UI supplies the timestamp; no payment API is called. */
export function completeTransfer(state: TransferState, transfer: Transfer, now: number): TransferState {
  checkNewTransfer(state, transfer);
  return { ...state, completed: [...state.completed, { ...transfer, iban: normalizeIban(transfer.iban), completedAt: now }] };
}
export function holdTransfer(state: TransferState, transfer: Transfer, reasons: string[], now: number): TransferState {
  checkNewTransfer(state, transfer);
  return { ...state, held: [...state.held, { transfer: { ...transfer, iban: normalizeIban(transfer.iban), instant: false }, createdAt: now, releaseAt: now + state.holdHours * 3600000, reasons: [...reasons], approvedBy: null }] };
}
export function cancelHeldTransfer(state: TransferState, id: string): TransferState {
  return { ...state, held: state.held.filter(item => item.transfer.id !== id) };
}
export function releaseHeldTransfer(state: TransferState, id: string, now: number): TransferState {
  const held = state.held.find(item => item.transfer.id === id);
  if (!held || !canReleaseHeldTransfer(held, now, state.trustedContact) || reported(held.transfer)) throw new Error('This transfer cannot be released yet.');
  const withoutHold = cancelHeldTransfer(state, id);
  return completeTransfer(withoutHold, { ...held.transfer, instant: false }, now);
}
export function simulateApproval(state: TransferState, id: string): TransferState {
  if (!state.trustedContact || !validTrustedContact(state.trustedContact)) throw new Error('Add a trusted contact in Settings first.');
  return { ...state, held: state.held.map(item => item.transfer.id === id ? { ...item, approvedBy: contactKey(state.trustedContact) } : item) };
}
export function savePayee(state: TransferState, name: string, iban: string, now: number): TransferState {
  if (!name.trim() || !validateIban(iban).valid) throw new Error('Enter a recipient name and valid IBAN first.');
  const normalized = normalizeIban(iban);
  const existing = state.savedPayees.find(item => item.iban === normalized);
  return { ...state, savedPayees: [...state.savedPayees.filter(item => item.iban !== normalized), { name: name.trim(), iban: normalized, addedAt: existing?.addedAt ?? now }] };
}

/** Fail closed on malformed local demo state rather than silently dropping a hold. */
export function restoreTransferState(raw: string): TransferState {
  const state: TransferState = JSON.parse(raw);
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  if (!state || !Array.isArray(state.savedPayees) || !Array.isArray(state.completed) || !Array.isArray(state.held) || !finite(state.clockOffset) || state.clockOffset < 0 || !finite(state.amountThreshold) || state.amountThreshold <= 0 || !finite(state.holdHours) || state.holdHours <= 0 || state.holdHours > 168) throw new Error('Invalid stored transfer settings.');
  if (state.trustedContact !== null && (!state.trustedContact || typeof state.trustedContact.name !== 'string' || typeof state.trustedContact.phone !== 'string' || !validTrustedContact(state.trustedContact))) throw new Error('Invalid stored trusted contact.');
  for (const payee of state.savedPayees) if (typeof payee.name !== 'string' || !payee.name.trim() || typeof payee.iban !== 'string' || !validateIban(payee.iban).valid || !finite(payee.addedAt)) throw new Error('Invalid stored payee.');
  const ids = new Set<string>();
  for (const item of [...state.completed.map(transfer => ({ transfer })), ...state.held]) {
    const transfer = item.transfer;
    if (!transfer || typeof transfer.id !== 'string' || typeof transfer.recipientName !== 'string' || typeof transfer.iban !== 'string' || typeof transfer.reference !== 'string' || typeof transfer.instant !== 'boolean' || !validTransfer(transfer) || reported(transfer) || ids.has(transfer.id)) throw new Error('Invalid stored transfer.');
    ids.add(transfer.id);
  }
  for (const item of state.completed) if (!finite(item.completedAt)) throw new Error('Invalid completion date.');
  for (const item of state.held) if (item.transfer.instant || !finite(item.createdAt) || !finite(item.releaseAt) || item.releaseAt < item.createdAt || !Array.isArray(item.reasons) || item.reasons.some(reason => typeof reason !== 'string') || (item.approvedBy !== null && typeof item.approvedBy !== 'string')) throw new Error('Invalid stored hold.');
  if (transferBalance(state) < 0 || availableTransferBalance(state) < 0) throw new Error('Invalid stored account balance.');
  return { ...state, savedPayees: state.savedPayees.map(item => ({ ...item, iban: normalizeIban(item.iban) })) };
}
