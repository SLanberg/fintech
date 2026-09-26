# Transfer protection demo

Run `npm run dev` in `frontend`, then open **Transfer** on Home or **New transfer** under Payments. This flow uses a separate fictitious EUR account with a €3,000 starting balance. It does not call payment APIs or change Safe to Spend or purchase nudge calculations.

In development, **Transfer demo scenarios** fills the form with four examples:

| Scenario | Starting outcome |
| --- | --- |
| €350 rent top-up to a previously paid landlord | ALLOW, followed by confirmation |
| €2,400 to a new “safe account”, name mismatch | HOLD |
| Recipient in the fictitious scam registry | BLOCK, with no way to proceed |
| €600 to a new recipient, matching name | ASK |

Outcomes use the current demo balance and settings. Reset the transfer demo account to repeat scenarios; the reset keeps saved payees and settings. Saving a recipient never counts as having paid them.

Settings includes one trusted contact, the amount threshold (default €500) and cooling-off duration (default four hours). The balance-share threshold is 50%. Amount comparisons include the exact threshold. Other risk signals prompt ASK; any Yes answer escalates to HOLD. Yes and No have identical visual treatment.

Holds reserve available funds without debiting the account, convert the payment to standard, and persist with their original deadline in browser storage. Cancel is one tap. At the deadline, payments below €1,000 can be released; €1,000 or more needs contact approval as well. Early release always needs contact approval. Approvals apply to one transfer and one contact; changing settings clears previous approvals. Development-only hold controls fast-forward the countdown and simulate approval without sending messages.

`data/scam_ibans.json` contains 58 **fictitious** reports. Every IBAN uses invented bank code `ZZZZ` and sort code `000000`, with a valid mod-97 checksum. The note in the file states that these are not real reports or accounts. `data/transfer_demo.json` supplies the name-check directory and outgoing payee history derived from the existing mock rent/electricity transactions. To regenerate both files with a Node version supporting TypeScript stripping:

```sh
node data/generate-transfer-demo.mjs
```

Pure logic lives in `frontend/src/lib/iban.ts`, `transfer-risk.ts` and `transfer-demo.ts`. Risk evaluation takes the clock, balance, histories, name-check result and registry as inputs; it does not access the UI, storage or a network. A reported IBAN always overrides every other decision. Risk weights and default thresholds are in `TRANSFER_RULES`.

Run `npm test` in `frontend` for IBAN/risk/hold tests and the existing spending tests. Transfer settings, holds and completed demo transfers use the separate storage key `fintech-transfer-protection-v1`. Malformed or unavailable storage disables new transfer actions so an existing saved hold is not silently discarded. This local simulation is not a production authorization or trusted-contact service.
