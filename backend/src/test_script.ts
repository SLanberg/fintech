import { initDatabase } from "./db/database";
import { UserRepository } from "./repositories/user.repository";
import { TransferService } from "./services/transfer.service";

console.log("--- STARTING SYSTEM INTEGRATION TEST ---");

// 1. Initialize SQLite Database
initDatabase();

// 2. Fetch primary entity user: Tyler Durden
const tyler = UserRepository.getPrimaryUser();
console.log("\n[TEST 1] Primary User Entity created in SQLite:");
console.log(`- Internal Immutable UUID: ${tyler.id}`);
console.log(`- Display Name: ${tyler.display_name}`);
console.log(`- Public Tag: @${tyler.tag}`);
console.log(`- Email: ${tyler.email}`);
console.log(`- Birth Year: ${tyler.birth_year}`);
console.log(`- Account Status: ${tyler.status}`);
console.log(`- Balance (Cents): ${tyler.balance_cents} (€${(tyler.balance_cents / 100).toFixed(2)})`);

// 3. Test Public Profile Mapping (Guaranteeing internal UUID is NOT exposed)
const publicProfile = UserRepository.toPublicProfile(tyler);
console.log("\n[TEST 2] Public Profile (Internal UUID hidden):", JSON.stringify(publicProfile, null, 2));

// 4. Test Tag Lookup via UNIQUE index
const foundByTag = UserRepository.findByTag("tyler");
console.log("\n[TEST 3] Tag Lookup Result (@tyler):", foundByTag ? "SUCCESS (User Found)" : "FAILED");

// 5. Test Money Transfer with Idempotency Key
const idempotencyKey = "test-idempotency-key-" + Date.now();

console.log("\n[TEST 4] Executing Transfer: Tyler (@tyler) -> Alexander (@alexander) for 15.00 EUR (1500 cents)");
const transfer1 = TransferService.executeTransfer({
  idempotency_key: idempotencyKey,
  sender_tag: "tyler",
  recipient_tag: "alexander",
  amount_cents: 1500, // 15.00 EUR
  description: "Test fight club membership fee",
});
console.log("Transfer 1 Result Status:", transfer1.statusCode);
console.log("Transfer 1 Response:", transfer1.body);

// 6. Test Idempotency: Repeating exact request with SAME key
console.log("\n[TEST 5] Re-sending EXACT SAME Transfer with SAME Idempotency Key:");
const transfer2 = TransferService.executeTransfer({
  idempotency_key: idempotencyKey,
  sender_tag: "tyler",
  recipient_tag: "alexander",
  amount_cents: 1500,
  description: "Test fight club membership fee",
});
console.log("Transfer 2 Result Status (Should be 201 cached):", transfer2.statusCode);
console.log("Transfer 2 Response (Identical to 1):", transfer2.body);

// 7. Test Idempotency Conflict: Reusing SAME key with DIFFERENT payload
console.log("\n[TEST 6] Reusing SAME Idempotency Key with DIFFERENT Payload (Must return 409 Conflict):");
const transfer3 = TransferService.executeTransfer({
  idempotency_key: idempotencyKey,
  sender_tag: "tyler",
  recipient_tag: "alexander",
  amount_cents: 9900, // Different amount!
  description: "Different payload test",
});
console.log("Transfer 3 Result Status (Should be 409):", transfer3.statusCode);
console.log("Transfer 3 Response:", transfer3.body);

// 8. Test Double-Spending Prevention
console.log("\n[TEST 7] Testing Double Spending / Overdraft Protection:");
const excessiveTransfer = TransferService.executeTransfer({
  idempotency_key: "excessive-key-" + Date.now(),
  sender_tag: "tyler",
  recipient_tag: "alexander",
  amount_cents: 999999999, // Exceeds balance
  description: "Overdraft attempt",
});
console.log("Excessive Transfer Result Status (Should be 400):", excessiveTransfer.statusCode);
console.log("Excessive Transfer Error:", excessiveTransfer.body);

console.log("\n--- INTEGRATION TEST COMPLETE ---");
