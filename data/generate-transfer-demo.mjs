import { readFileSync, writeFileSync } from 'node:fs';
import { fictitiousDemoIban } from '../frontend/src/lib/iban.ts';

const note = 'FICTITIOUS DEMO DATA. Every IBAN uses invented bank code ZZZZ and sort code 000000. Checksum validity is only for testing, not evidence of a real bank account or reported beneficiary. All names, reports and approval events are simulated.';
const scamTypes = ['investment scam', 'safe-account scam', 'fake online shop', 'romance scam'];
const entries = Array.from({ length: 58 }, (_, index) => ({
  iban: fictitiousDemoIban(index + 1), scamType: scamTypes[index % 4],
  dateReported: `2026-05-${String(index % 28 + 1).padStart(2, '0')}`, sourceLabel: `Fictitious demo report ${index + 1}`,
}));
writeFileSync(new URL('./scam_ibans.json', import.meta.url), JSON.stringify({ note, entries }, null, 2) + '\n');
const directory = [
  { iban: fictitiousDemoIban(1001), accountHolder: 'Paper Street Rentals', closeNames: ['Paper Street Rental'], tag: 'landlord' },
  { iban: fictitiousDemoIban(1002), accountHolder: 'Demo Energy Services', closeNames: ['Demo Energy'], tag: 'energy' },
  { iban: fictitiousDemoIban(1003), accountHolder: 'Demo Bike Seller', closeNames: ['Bike Seller'], tag: 'new-payee' },
  { iban: fictitiousDemoIban(1004), accountHolder: 'Fictitious Merchant Ltd', closeNames: [], tag: 'safe-account' },
  { iban: entries[0].iban, accountHolder: 'Demo Investments', closeNames: [], tag: 'reported' },
];
const fixture = JSON.parse(readFileSync(new URL('../mock/safe-to-spend.json', import.meta.url), 'utf8'));
const history = fixture.transactions.filter(tx => ['Rent', 'Electricity'].includes(tx.name)).map(tx => ({
  id: tx.id, recipientName: tx.name === 'Rent' ? directory[0].accountHolder : directory[1].accountHolder,
  iban: tx.name === 'Rent' ? directory[0].iban : directory[1].iban, amount: tx.amount,
  reference: tx.name, instant: false, completedAt: Date.parse(`${tx.date}T12:00:00Z`),
}));
writeFileSync(new URL('./transfer_demo.json', import.meta.url), JSON.stringify({ note, account: { name: 'Transfer protection demo account', balance: 3000, currency: 'EUR' }, directory, history }, null, 2) + '\n');
