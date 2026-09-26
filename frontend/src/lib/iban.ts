// Format lengths from the SWIFT IBAN registry. Checksum validity is not proof
// that a bank/account exists. Demo accounts intentionally use an invented bank.
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD:24, AE:23, AL:28, AT:20, AZ:28, BA:20, BE:16, BG:22, BH:22, BI:27, BR:29,
  BY:28, CH:21, CR:22, CY:28, CZ:24, DE:22, DJ:27, DK:18, DO:28, EE:20, EG:29,
  ES:24, FI:18, FK:18, FO:18, FR:27, GB:22, GE:22, GI:23, GL:18, GR:27, GT:28,
  HN:28, HR:21, HU:28, IE:22, IL:23, IQ:23, IS:26, IT:27, JO:30, KZ:20, KW:30,
  LC:32, LI:21, LB:28, LT:20, LU:20, LV:21, LY:25, MC:27, MD:24, ME:22, MK:19,
  MN:20, MR:27, MT:31, MU:30, NI:28, NL:18, NO:15, OM:23, PK:24, PL:28, PS:29,
  PT:25, QA:29, RO:24, RS:22, RU:33, SA:24, SC:31, SD:18, SE:24, SI:19, SK:24,
  SM:27, SO:23, ST:25, SV:28, TL:23, TN:24, TR:26, UA:29, VA:22, VG:24, XK:20,
};
export const normalizeIban = (iban: string) => iban.replace(/\s/g, '').toUpperCase();
export function ibanMod97(value: string): number {
  let remainder = 0;
  for (const char of value) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    if (!/^\d+$/.test(digits)) return -1;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}
export function validateIban(value: string): { valid: boolean; normalized: string; error?: string } {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { valid: false, normalized: iban, error: 'Use a country code, two check digits and an alphanumeric account number.' };
  if (Number(iban.slice(2, 4)) < 2 || Number(iban.slice(2, 4)) > 98) return { valid: false, normalized: iban, error: 'The IBAN check digits must be between 02 and 98.' };
  const country = iban.slice(0, 2);
  if (!IBAN_LENGTHS[country] || iban.length !== IBAN_LENGTHS[country]) return { valid: false, normalized: iban, error: 'The IBAN country or length is invalid.' };
  const bban = iban.slice(4);
  const formats: Record<string, RegExp> = {
    GB: /^[A-Z]{4}\d{14}$/, IE: /^[A-Z]{4}\d{14}$/, NL: /^[A-Z]{4}\d{10}$/,
    DE: /^\d{18}$/, EE: /^\d{16}$/, FI: /^\d{14}$/, LT: /^\d{16}$/,
    FR: /^\d{10}[A-Z0-9]{11}\d{2}$/, IT: /^[A-Z]\d{10}[A-Z0-9]{12}$/,
    ES: /^\d{20}$/, PL: /^\d{24}$/, SE: /^\d{20}$/, BE: /^\d{12}$/,
  };
  if (formats[country] && !formats[country].test(bban)) return { valid: false, normalized: iban, error: 'The account number does not match this country’s IBAN format.' };
  if (ibanMod97(bban + iban.slice(0, 4)) !== 1) return { valid: false, normalized: iban, error: 'The IBAN checksum is invalid. Check the account number.' };
  return { valid: true, normalized: iban };
}

export function fictitiousDemoIban(accountNumber: number): string {
  if (!Number.isInteger(accountNumber) || accountNumber < 1 || accountNumber > 99999999) throw new RangeError('Invalid demo account number.');
  const bban = `ZZZZ000000${String(accountNumber).padStart(8, '0')}`;
  return `GB${String(98 - ibanMod97(`${bban}GB00`)).padStart(2, '0')}${bban}`;
}
