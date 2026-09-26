import { normalizeIban, validateIban } from './iban.ts';

export const TRANSFER_RULES = {
  amountThreshold: 500, balanceFraction: 0.5, recentPayeeMs: 24 * 60 * 60 * 1000,
  holdMs: 4 * 60 * 60 * 1000, trustedApprovalThreshold: 1000,
  weights: { newPayee: 20, recentPayee: 15, largeAmount: 20, balanceShare: 30, instant: 5, noMatch: 45, closeMatch: 10, answerYes: 40 },
} as const;
export type VerificationResult = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH';
export type TransferDecision = 'ALLOW' | 'ASK' | 'HOLD' | 'BLOCK';
export type ScamType = 'investment scam' | 'safe-account scam' | 'fake online shop' | 'romance scam';
export interface ScamBeneficiary { iban: string; scamType: ScamType; dateReported: string; sourceLabel: string }
export interface Transfer { id: string; recipientName: string; iban: string; amount: number; reference: string; instant: boolean }
export interface SavedPayee { name: string; iban: string; addedAt: number }
export interface PaidTransfer extends Transfer { completedAt: number }
export interface TrustedContact { name: string; phone: string }
export interface HeldTransfer {
  transfer: Transfer;
  createdAt: number;
  releaseAt: number;
  reasons: string[];
  approvedBy: string | null;
}
export interface TransferContext {
  now: number;
  balance: number;
  previouslyPaidIbans: readonly string[];
  savedPayees: readonly SavedPayee[];
  verification: VerificationResult;
  scamBeneficiaries: readonly ScamBeneficiary[];
  askAnswers?: readonly boolean[];
  amountThreshold?: number;
  balanceFraction?: number;
}

/** Pure: all history, verification, registry and time come from the caller.
 * Explicit rules determine the decision; weights expose the accumulated risk.
 * Any non-instant signal prompts ASK unless a HOLD/BLOCK rule takes priority.
 */
export function evaluateTransfer(transfer: Transfer, context: TransferContext): { decision: TransferDecision; reasons: string[]; riskScore: number } {
  const iban = normalizeIban(transfer.iban);
  const scam = context.scamBeneficiaries.find(entry => normalizeIban(entry.iban) === iban);
  if (scam) return { decision: 'BLOCK', reasons: [`The recipient is linked to a reported ${scam.scamType}.`], riskScore: 100 };
  if (!validateIban(iban).valid) throw new RangeError('Invalid IBAN.');
  const threshold = context.amountThreshold ?? TRANSFER_RULES.amountThreshold;
  const fraction = context.balanceFraction ?? TRANSFER_RULES.balanceFraction;
  if (![transfer.amount, context.balance, context.now, threshold, fraction].every(Number.isFinite) || transfer.amount <= 0 || context.balance < 0 || threshold <= 0 || fraction <= 0 || fraction > 1) throw new RangeError('Invalid transfer evaluation inputs.');
  if (!['MATCH', 'CLOSE_MATCH', 'NO_MATCH'].includes(context.verification)) throw new RangeError('Invalid payee verification result.');
  const newPayee = !context.previouslyPaidIbans.some(paid => normalizeIban(paid) === iban);
  const saved = context.savedPayees.find(payee => normalizeIban(payee.iban) === iban);
  const recentPayee = !!saved && context.now - saved.addedAt < TRANSFER_RULES.recentPayeeMs;
  const largeAmount = Math.round(transfer.amount * 100) >= Math.round(threshold * 100);
  const balanceShare = Math.round(transfer.amount * 100) >= Math.round(context.balance * fraction * 100);
  const reasons: string[] = [];
  let riskScore = 0;
  const signal = (triggered: boolean, reason: string, weight: number) => { if (triggered) { reasons.push(reason); riskScore += weight; } };
  signal(newPayee, 'You have never paid this recipient before.', TRANSFER_RULES.weights.newPayee);
  signal(recentPayee, 'This payee was saved less than 24 hours ago.', TRANSFER_RULES.weights.recentPayee);
  signal(largeAmount, `The amount is at least €${threshold.toFixed(2)}.`, TRANSFER_RULES.weights.largeAmount);
  signal(balanceShare, `The amount is at least ${fraction * 100}% of your current balance.`, TRANSFER_RULES.weights.balanceShare);
  signal(transfer.instant, 'Instant payments are difficult to stop once sent.', TRANSFER_RULES.weights.instant);
  signal(context.verification === 'NO_MATCH', 'The account holder name does not match the recipient name.', TRANSFER_RULES.weights.noMatch);
  signal(context.verification === 'CLOSE_MATCH', 'The account holder name is only a close match.', TRANSFER_RULES.weights.closeMatch);
  const answerYes = context.askAnswers?.some(answer => answer === true) ?? false;
  signal(answerYes, 'You reported pressure to pay, a safe-account request, or a social-media investment or seller.', TRANSFER_RULES.weights.answerYes);
  const hold = (newPayee && balanceShare) || (context.verification === 'NO_MATCH' && largeAmount) || answerYes;
  const nonInstantSignal = newPayee || recentPayee || largeAmount || balanceShare || context.verification !== 'MATCH';
  return { decision: hold ? 'HOLD' : nonInstantSignal ? 'ASK' : 'ALLOW', reasons, riskScore: Math.min(99, riskScore) };
}

export const normalizePayeeName = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function verifyPayee(iban: string, name: string, directory: readonly { iban: string; accountHolder: string; closeNames: readonly string[] }[]): VerificationResult {
  const record = directory.find(entry => normalizeIban(entry.iban) === normalizeIban(iban));
  if (!record) return 'NO_MATCH';
  const candidate = normalizePayeeName(name);
  if (candidate && candidate === normalizePayeeName(record.accountHolder)) return 'MATCH';
  return record.closeNames.some(alias => normalizePayeeName(alias) === candidate) ? 'CLOSE_MATCH' : 'NO_MATCH';
}

export function derivePaidPayees(history: readonly PaidTransfer[]): SavedPayee[] {
  const payees = new Map<string, SavedPayee>();
  for (const transfer of history) {
    const iban = normalizeIban(transfer.iban);
    const existing = payees.get(iban);
    if (!existing || transfer.completedAt < existing.addedAt) payees.set(iban, { iban, name: transfer.recipientName, addedAt: transfer.completedAt });
  }
  return [...payees.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function contactKey(contact: TrustedContact | null): string | null {
  return contact ? `${contact.name.trim()}|${contact.phone.replace(/\D/g, '')}` : null;
}
export function validTrustedContact(contact: TrustedContact): boolean {
  return !!contact.name.trim() && /^\+?[\d ()-]{6,24}$/.test(contact.phone) && /^\d{6,15}$/.test(contact.phone.replace(/\D/g, ''));
}
export function canReleaseHeldTransfer(held: HeldTransfer, now: number, contact: TrustedContact | null, approvalThreshold: number = TRANSFER_RULES.trustedApprovalThreshold): boolean {
  if (![now, held.createdAt, held.releaseAt, held.transfer.amount, approvalThreshold].every(Number.isFinite) || held.releaseAt < held.createdAt || held.transfer.amount <= 0 || held.transfer.instant || approvalThreshold <= 0) return false;
  const approved = contactKey(contact) !== null && held.approvedBy === contactKey(contact);
  if (now < held.releaseAt) return approved;
  return held.transfer.amount < approvalThreshold || approved;
}
export const SCAM_EXPLANATIONS: Record<ScamType, string> = {
  'investment scam': 'A caller or advert promises unusually high or guaranteed returns. You may see a convincing trading dashboard, then be asked to pay more to withdraw. The investment and profits can be invented.',
  'safe-account scam': 'Someone impersonates your bank or the police and says your money is in danger. They ask you to move it to a “safe account” that they control. Your bank will never ask you to move money to a safe account.',
  'fake online shop': 'A seller or website advertises attractive prices and asks for a bank transfer. The shop may copy a real brand or create urgency around a limited offer. Goods may never arrive and the seller may disappear.',
  'romance scam': 'Someone builds a relationship online and then asks for money for an emergency, travel, or an investment. Their identity and story may be invented. Requests often become repeated or increasingly urgent.',
};
