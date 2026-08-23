// scripts/test-production-auth-hotfix-live.js
// Live Production Verification Script for Web Session Token Hotfix (SEC-001)

const PROD_URL = process.env.PROD_URL || 'https://haulbox.onrender.com';

async function runProductionAuthVerification() {
  console.log('================================================================================');
  console.log(`🌐 LIVE PRODUCTION SECURITY VERIFICATION: ${PROD_URL}`);
  console.log('================================================================================\n');

  // Wait/ping health first
  let retries = 5;
  while (retries > 0) {
    try {
      const ping = await fetch(`${PROD_URL}/auth/verify-session`);
      if (ping.status === 401) {
        console.log('✓ Render deployment active and serving updated auth routes.\n');
        break;
      }
    } catch (e) {
      console.log(`Waiting for Render deployment to finish... (${retries} attempts left)`);
      await new Promise(r => setTimeout(r, 5000));
      retries--;
    }
  }

  // TEST P1: Legacy localStorage email impersonation bypass attempt
  console.log('--- TEST P1: Production check - Legacy localStorage email impersonation bypass ---');
  const resP1 = await fetch(`${PROD_URL}/auth/verify-session`, {
    headers: { 'Authorization': 'Bearer admin@haulbox.com' }
  });
  const statusP1 = resP1.status;
  const bodyP1 = await resP1.json();
  console.log(`Status Code: ${statusP1}`);
  console.log(`Response Body: ${JSON.stringify(bodyP1)}`);
  if (statusP1 === 401 && bodyP1.ok === false) {
    console.log('✓ LIVE PROD VERIFIED: Legacy localStorage email impersonation bypass IS DEAD (401 Unauthorized).\n');
  } else {
    throw new Error(`PROD TEST P1 FAILED: Expected 401, got ${statusP1}`);
  }

  // TEST P2: Unauthenticated /auth/claim attempt
  console.log('--- TEST P2: Production check - Unauthenticated POST /auth/claim attempt ---');
  const resP2 = await fetch(`${PROD_URL}/auth/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromAccountId: 'login_attempt_hack', toAccountId: 'admin' })
  });
  const statusP2 = resP2.status;
  const bodyP2 = await resP2.json();
  console.log(`Status Code: ${statusP2}`);
  console.log(`Response Body: ${JSON.stringify(bodyP2)}`);
  if (statusP2 === 401) {
    console.log('✓ LIVE PROD VERIFIED: Unauthenticated /auth/claim requests BLOCKED (401 Unauthorized).\n');
  } else {
    throw new Error(`PROD TEST P2 FAILED: Expected 401, got ${statusP2}`);
  }

  // TEST P3: Unauthorized Admin Account Claim Attempt
  console.log('--- TEST P3: Production check - Unauthorized claim targeting Admin account ---');
  const resP3 = await fetch(`${PROD_URL}/auth/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid_or_unauthorized_token'
    },
    body: JSON.stringify({ fromAccountId: 'login_attempt_hack', toAccountId: 'admin' })
  });
  const statusP3 = resP3.status;
  const bodyP3 = await resP3.json();
  console.log(`Status Code: ${statusP3}`);
  console.log(`Response Body: ${JSON.stringify(bodyP3)}`);
  if (statusP3 === 401 || statusP3 === 403) {
    console.log('✓ LIVE PROD VERIFIED: Unauthorized claim targeting Admin account BLOCKED (401/403 Forbidden).\n');
  } else {
    throw new Error(`PROD TEST P3 FAILED: Expected 401/403, got ${statusP3}`);
  }

  // TEST P4: Unauthorized / Unresolvable Dispatcher Account Claim Attempt
  console.log('--- TEST P4: Production check - Unauthorized claim targeting Unresolvable / Mismatched Dispatcher Account ---');
  const resP4 = await fetch(`${PROD_URL}/auth/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer invalid_or_unauthorized_token'
    },
    body: JSON.stringify({ fromAccountId: 'login_attempt_hack', toAccountId: 'unresolvable_dispatcher_999' })
  });
  const statusP4 = resP4.status;
  const bodyP4 = await resP4.json();
  console.log(`Status Code: ${statusP4}`);
  console.log(`Response Body: ${JSON.stringify(bodyP4)}`);
  if (statusP4 === 401 || statusP4 === 403) {
    console.log('✓ LIVE PROD VERIFIED: Unauthorized claim targeting Dispatcher account BLOCKED (401/403 Forbidden).\n');
  } else {
    throw new Error(`PROD TEST P4 FAILED: Expected 401/403, got ${statusP4}`);
  }

  console.log('================================================================================');
  console.log('✅ LIVE PRODUCTION VERIFICATION COMPLETE: SEC-001 HOTFIX CONFIRMED LIVE AND DEAD IN PROD!');
  console.log('================================================================================\n');
}

runProductionAuthVerification().catch(err => {
  console.error('❌ PRODUCTION VERIFICATION FAILED:', err);
  process.exit(1);
});
