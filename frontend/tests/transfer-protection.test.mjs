import test from 'node:test';
import assert from 'node:assert/strict';
import { fictitiousDemoIban, ibanMod97, normalizeIban, validateIban } from '../src/lib/iban.ts';
import { canReleaseHeldTransfer, contactKey, derivePaidPayees, evaluateTransfer, SCAM_EXPLANATIONS, TRANSFER_RULES, validTrustedContact, verifyPayee } from '../src/lib/transfer-risk.ts';
import { availableTransferBalance, cancelHeldTransfer, completeTransfer, holdTransfer, initialTransferState, paidIbans, releaseHeldTransfer, restoreTransferState, savePayee, scamBeneficiaries, simulateApproval, transferBalance, transferDemo } from '../src/lib/transfer-demo.ts';

const NOW = Date.UTC(2026, 8, 26, 12);
const IBAN = fictitiousDemoIban(1003);
const transfer = (overrides = {}) => ({ id: 'test-transfer', recipientName: 'Demo Bike Seller', iban: IBAN, amount: 100, reference: 'Demo', instant: false, ...overrides });
const context = (overrides = {}) => ({ now: NOW, balance: 3000, previouslyPaidIbans: [IBAN], savedPayees: [], verification: 'MATCH', scamBeneficiaries, ...overrides });
const evaluate = (payment = {}, options = {}) => evaluateTransfer(transfer(payment), context(options));
const contact = { name: 'Demo Friend', phone: '+372 5555 1234' };

test('IBAN normalizes whitespace/case, validates mod-97 and rejects malformed values', () => {
  const spaced = IBAN.toLowerCase().replace(/(.{4})/g, '$1 ');
  assert.equal(normalizeIban(`\n${spaced}\t`), IBAN);
  assert.deepEqual(validateIban(spaced), { valid: true, normalized: IBAN });
  assert.equal(ibanMod97(IBAN.slice(4) + IBAN.slice(0, 4)), 1);
  assert.equal(validateIban('GB29NWBK60161331926819').valid, true);
  assert.equal(validateIban('EE382200221020145685').valid, true);
  for (const bad of ['', '1234', 'XX29ZZZZ00000000001003', IBAN.slice(0, -1), IBAN + '1', IBAN.replace('ZZZZ', '1234'), IBAN.slice(0, -1) + '9', IBAN.replace('GB38', 'GB00'), IBAN.replace('GB38', 'GB99'), IBAN + '!']) {
    assert.equal(validateIban(bad).valid, false, bad);
  }
  assert.throws(() => fictitiousDemoIban(0), RangeError);
});

test('all 58 beneficiaries are unique fictitious accounts with valid checksums and four scam types', () => {
  assert.equal(scamBeneficiaries.length, 58);
  assert.equal(new Set(scamBeneficiaries.map(item => item.iban)).size, 58);
  assert.equal(new Set(scamBeneficiaries.map(item => item.scamType)).size, 4);
  for (const item of scamBeneficiaries) {
    assert.match(item.iban, /^GB\d{2}ZZZZ000000\d{8}$/);
    assert.equal(validateIban(item.iban).valid, true);
    assert.match(item.dateReported, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(item.sourceLabel, /Fictitious/);
    assert.ok(SCAM_EXPLANATIONS[item.scamType]);
  }
});

test('no signals and only instant payment ALLOW', () => {
  assert.deepEqual(evaluate(), { decision: 'ALLOW', reasons: [], riskScore: 0 });
  const result = evaluate({ instant: true });
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.riskScore, TRANSFER_RULES.weights.instant);
});

test('BLOCK overrides history, matching name, ASK answers, amount and all HOLD signals', () => {
  const reported = scamBeneficiaries[0].iban.toLowerCase().replace(/(.{4})/g, '$1 ');
  for (const options of [context({ previouslyPaidIbans: [reported] }), context({ verification: 'NO_MATCH', askAnswers: [true, true, true], previouslyPaidIbans: [] })]) {
    const result = evaluateTransfer(transfer({ iban: reported, amount: 2400, instant: true }), options);
    assert.equal(result.decision, 'BLOCK'); assert.equal(result.riskScore, 100);
    assert.match(result.reasons[0], /reported investment scam/);
  }
  assert.equal(evaluate({ iban: reported, amount: Infinity }, { balance: NaN }).decision, 'BLOCK');
});

test('normalization applies to previous payees and recently saved payees', () => {
  const lower = IBAN.toLowerCase().replace(/(.{4})/g, '$1 ');
  assert.equal(evaluate({ iban: lower }, { previouslyPaidIbans: [IBAN] }).decision, 'ALLOW');
  assert.equal(evaluate({}, { previouslyPaidIbans: [lower] }).decision, 'ALLOW');
  const result = evaluate({}, { savedPayees: [{ name: 'Demo', iban: lower, addedAt: NOW - 1000 }] });
  assert.equal(result.decision, 'ASK'); assert.match(result.reasons[0], /less than 24 hours/);
});

test('new payee and amount threshold: exact boundary ASK, configurable threshold honored', () => {
  const options = { previouslyPaidIbans: [] };
  const result = evaluate({ amount: 500 }, options);
  assert.equal(result.decision, 'ASK'); assert.equal(result.reasons.length, 2);
  assert.match(result.reasons[0], /never paid/); assert.match(result.reasons[1], /500/);
  assert.equal(evaluate({ amount: 499.99 }, options).reasons.length, 1);
  assert.equal(evaluate({ amount: 600 }, { ...options, amountThreshold: 700 }).reasons.length, 1);
  assert.equal(evaluate({ amount: 600 }, { ...options, amountThreshold: 600 }).reasons.length, 2);
});

test('new payee at 50% of balance HOLD; immediately below is ASK; configurable fraction honored', () => {
  assert.equal(evaluate({ amount: 1499.99 }, { previouslyPaidIbans: [] }).decision, 'ASK');
  assert.equal(evaluate({ amount: 1500 }, { previouslyPaidIbans: [] }).decision, 'HOLD');
  assert.equal(evaluate({ amount: 600 }, { previouslyPaidIbans: [], balance: 1200 }).decision, 'HOLD');
  assert.equal(evaluate({ amount: 600 }, { previouslyPaidIbans: [], balanceFraction: 0.2 }).decision, 'HOLD');
  // Being a known payee alone must not activate the new-payee HOLD rule.
  assert.equal(evaluate({ amount: 1500 }).decision, 'ASK');
});

test('NO_MATCH plus amount threshold HOLD even for a known payee; CLOSE_MATCH is weaker', () => {
  assert.equal(evaluate({ amount: 500 }, { verification: 'NO_MATCH' }).decision, 'HOLD');
  assert.equal(evaluate({ amount: 499.99 }, { verification: 'NO_MATCH' }).decision, 'ASK');
  assert.equal(evaluate({ amount: 500 }, { verification: 'CLOSE_MATCH' }).decision, 'ASK');
  assert.ok(evaluate({}, { verification: 'NO_MATCH' }).riskScore > evaluate({}, { verification: 'CLOSE_MATCH' }).riskScore);
  assert.match(evaluate({}, { verification: 'NO_MATCH' }).reasons[0], /does not match/);
  assert.match(evaluate({}, { verification: 'CLOSE_MATCH' }).reasons[0], /close match/);
});

test('each Yes answer escalates ASK to HOLD; all No answers preserve ASK', () => {
  const options = { previouslyPaidIbans: [] };
  for (let index = 0; index < 3; index++) {
    const result = evaluate({ amount: 600 }, { ...options, askAnswers: [0, 1, 2].map(i => i === index) });
    assert.equal(result.decision, 'HOLD'); assert.match(result.reasons.at(-1), /pressure to pay/);
  }
  assert.equal(evaluate({ amount: 600 }, { ...options, askAnswers: [false, false, false] }).decision, 'ASK');
});

test('24-hour saved-payee boundary, independent signal weights and immutability', () => {
  const recent = { name: 'Demo', iban: IBAN, addedAt: NOW - TRANSFER_RULES.recentPayeeMs + 1 };
  assert.equal(evaluate({}, { savedPayees: [recent] }).decision, 'ASK');
  assert.equal(evaluate({}, { savedPayees: [{ ...recent, addedAt: NOW - TRANSFER_RULES.recentPayeeMs }] }).decision, 'ALLOW');
  const payment = Object.freeze(transfer({ amount: 500, instant: true }));
  const options = Object.freeze(context({ previouslyPaidIbans: Object.freeze([]), savedPayees: Object.freeze([recent]) }));
  const result = evaluateTransfer(payment, options);
  assert.equal(result.riskScore, 20 + 15 + 20 + 5);
  assert.equal(result.reasons.length, 4);
  assert.deepEqual(evaluateTransfer(payment, options), result);
});

test('invalid IBAN and monetary/context inputs cannot be evaluated as payable', () => {
  assert.throws(() => evaluate({ iban: 'invalid' }), RangeError);
  for (const amount of [0, -1, NaN, Infinity]) assert.throws(() => evaluate({ amount }), RangeError);
  for (const options of [{ balance: -1 }, { now: NaN }, { amountThreshold: 0 }, { balanceFraction: 0 }, { balanceFraction: 1.1 }, { verification: 'UNKNOWN' }]) assert.throws(() => evaluate({}, options), RangeError);
});

test('simulated VoP gives MATCH, CLOSE_MATCH and NO_MATCH with normalized IBAN/name', () => {
  assert.equal(verifyPayee(IBAN.toLowerCase(), 'demo bike seller', transferDemo.directory), 'MATCH');
  assert.equal(verifyPayee(IBAN, 'Bike Seller', transferDemo.directory), 'CLOSE_MATCH');
  assert.equal(verifyPayee(IBAN, 'Bank Safe Account', transferDemo.directory), 'NO_MATCH');
  assert.equal(verifyPayee(fictitiousDemoIban(9876), 'Unknown', transferDemo.directory), 'NO_MATCH');
});

test('previous payees derive from history, distinct from saved-only recipients', () => {
  const history = [
    { ...transfer(), completedAt: NOW },
    { ...transfer({ id: 'earlier', iban: IBAN.toLowerCase() }), completedAt: NOW - 1000 },
  ];
  const payees = derivePaidPayees(history);
  assert.equal(payees.length, 1); assert.equal(payees[0].iban, IBAN); assert.equal(payees[0].addedAt, NOW - 1000);
  const state = savePayee(initialTransferState(), 'Demo Bike Seller', IBAN, NOW);
  assert.equal(paidIbans(state).includes(IBAN), false);
  assert.equal(state.savedPayees.at(-1).addedAt, NOW);
  assert.equal(savePayee(state, 'Updated name', IBAN.toLowerCase(), NOW + 100).savedPayees.at(-1).addedAt, NOW);
});

test('hold converts to standard payment, reserves funds and uses configurable immutable deadline', () => {
  const initial = { ...initialTransferState(), holdHours: 2 };
  const held = holdTransfer(initial, transfer({ amount: 600, instant: true }), ['Demo risk'], NOW);
  assert.equal(held.held[0].transfer.instant, false);
  assert.equal(held.held[0].releaseAt, NOW + 2 * 3600000);
  assert.equal(transferBalance(held), 3000); assert.equal(availableTransferBalance(held), 2400);
  assert.equal(initial.held.length, 0);
  assert.throws(() => completeTransfer(held, transfer({ id: 'other', amount: 2500 }), NOW), /funds/);
});

test('cancel is immediate, does not debit funds or create paid history, and cancelled hold cannot release', () => {
  const held = holdTransfer(initialTransferState(), transfer(), [], NOW);
  const cancelled = cancelHeldTransfer(held, 'test-transfer');
  assert.equal(cancelled.held.length, 0); assert.equal(cancelled.completed.length, 0);
  assert.equal(availableTransferBalance(cancelled), 3000);
  assert.throws(() => releaseHeldTransfer(cancelled, 'test-transfer', NOW + TRANSFER_RULES.holdMs), /cannot be released/);
});

test('small holds cannot release early without approval; release at exact deadline debits once', () => {
  const state = holdTransfer(initialTransferState(), transfer({ amount: 999.99 }), [], NOW);
  const held = state.held[0];
  assert.equal(canReleaseHeldTransfer(held, held.releaseAt - 1, null), false);
  assert.equal(canReleaseHeldTransfer(held, held.releaseAt, null), true);
  assert.throws(() => releaseHeldTransfer(state, 'test-transfer', NOW), /cannot be released/);
  const released = releaseHeldTransfer(state, 'test-transfer', held.releaseAt);
  assert.equal(released.held.length, 0); assert.equal(released.completed[0].instant, false);
  assert.equal(transferBalance(released), 2000.01);
  assert.throws(() => releaseHeldTransfer(released, 'test-transfer', held.releaseAt), /cannot be released/);
  assert.throws(() => completeTransfer(released, transfer(), NOW), /already been recorded/);
});

test('held transfers of exactly 1000 or more require contact approval even after deadline', () => {
  for (const amount of [1000, 2400]) {
    let state = holdTransfer({ ...initialTransferState(), trustedContact: contact }, transfer({ amount }), [], NOW);
    const deadline = state.held[0].releaseAt;
    assert.equal(canReleaseHeldTransfer(state.held[0], deadline + 1, contact), false);
    assert.throws(() => releaseHeldTransfer(state, 'test-transfer', deadline), /cannot be released/);
    state = simulateApproval(state, 'test-transfer');
    assert.equal(canReleaseHeldTransfer(state.held[0], NOW, contact), true);
    assert.equal(releaseHeldTransfer(state, 'test-transfer', NOW).completed.length, 1);
  }
});

test('approval is scoped to one transfer and exact contact; absent/changed contact cannot release early', () => {
  let state = { ...initialTransferState(), trustedContact: contact };
  state = holdTransfer(state, transfer(), [], NOW);
  state = holdTransfer(state, transfer({ id: 'second' }), [], NOW);
  state = simulateApproval(state, 'test-transfer');
  assert.equal(state.held[0].approvedBy, contactKey(contact));
  assert.equal(canReleaseHeldTransfer(state.held[0], NOW, contact), true);
  assert.equal(canReleaseHeldTransfer(state.held[1], NOW, contact), false);
  assert.equal(canReleaseHeldTransfer(state.held[0], NOW, null), false);
  assert.equal(canReleaseHeldTransfer(state.held[0], NOW, { ...contact, phone: '+372 1111 2222' }), false);
  assert.throws(() => simulateApproval(initialTransferState(), 'test-transfer'), /Add a trusted contact/);
  assert.equal(canReleaseHeldTransfer(state.held[0], NaN, contact), false);
  assert.equal(validTrustedContact(contact), true);
  assert.equal(validTrustedContact({ name: 'Demo', phone: '------' }), false);
});

test('persistence retains holds/deadlines/approvals; rejects malformed state and blocked beneficiary payments', () => {
  const state = simulateApproval(holdTransfer({ ...initialTransferState(), trustedContact: contact }, transfer(), ['Risk'], NOW), 'test-transfer');
  assert.deepEqual(restoreTransferState(JSON.stringify(state)), state);
  assert.throws(() => restoreTransferState('{}'), /Invalid/);
  assert.throws(() => restoreTransferState(JSON.stringify({ ...state, held: [{ ...state.held[0], transfer: { ...state.held[0].transfer, instant: true } }] })), /Invalid/);
  assert.throws(() => restoreTransferState(JSON.stringify({ ...state, completed: [{ ...transfer({ amount: 3001 }), completedAt: NOW }], held: [] })), /balance/);
  for (const operation of [completeTransfer, holdTransfer]) {
    assert.throws(() => operation(initialTransferState(), transfer({ iban: scamBeneficiaries[0].iban }), [], NOW), /cannot be paid/);
  }
  const blockedHold = { ...state, held: [{ ...state.held[0], transfer: transfer({ iban: scamBeneficiaries[0].iban }) }] };
  assert.throws(() => releaseHeldTransfer(blockedHold, 'test-transfer', NOW + TRANSFER_RULES.holdMs), /cannot be released/);
});

test('all four demo scenarios evaluate to their stated outcomes from the initial account', () => {
  const state = initialTransferState();
  const cases = [['landlord', 350, undefined, 'ALLOW'], ['safe-account', 2400, 'Bank Safe Account', 'HOLD'], ['reported', 100, undefined, 'BLOCK'], ['new-payee', 600, undefined, 'ASK']];
  for (const [tag, amount, name, expected] of cases) {
    const merchant = transferDemo.directory.find(item => item.tag === tag);
    const recipientName = name ?? merchant.accountHolder;
    const result = evaluateTransfer(transfer({ iban: merchant.iban, recipientName, amount, instant: true }), context({ previouslyPaidIbans: paidIbans(state), savedPayees: state.savedPayees, verification: verifyPayee(merchant.iban, recipientName, transferDemo.directory) }));
    assert.equal(result.decision, expected, tag);
  }
});
