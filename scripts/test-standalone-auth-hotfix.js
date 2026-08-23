// scripts/test-standalone-auth-hotfix.js
// Automated verification script for Web Admin/Dispatcher Session Token Authentication Hotfix (P1.1 / P1.2)

const express = require('express');
const http = require('http');
const authRouter = require('../routes/auth');
const store = require('../lib/store');

// Mock in-memory token store & dataStore for isolated test execution without live database dependency
const memStore = new Map();
store.get = async (id) => memStore.get(id) || null;
store.set = async (id, rec) => { memStore.set(id, rec); return rec; };
store.claim = async (fromId, toId) => {
  const rec = memStore.get(fromId);
  if (rec) {
    memStore.delete(fromId);
    memStore.set(toId, rec);
  }
  return rec || null;
};

// Mock dataStore.loadFullState for test dispatcher lookup (including dual email fields)
const dataStore = require('../lib/dataStore');
dataStore.loadFullState = async () => ({
  dispatchers: [
    { id: 'disp-A', name: 'Dispatcher Alice', email: 'alice@haulbox.com' },
    { id: 'disp-B', name: 'Dispatcher Bob', email: 'bob@haulbox.com' },
    { id: 'disp-Steve', name: 'Steve Smith', email: 'steve@haulbox.com', googleAccountEmail: 'stevesmith@gmail.com' },
  ]
});

async function runAuthHotfixTest() {
  console.log('================================================================================');
  console.log('🔒 STANDALONE SECURITY HOTFIX TEST: WEB ADMIN / DISPATCHER AUTHENTICATION');
  console.log('================================================================================\n');

  const app = express();
  app.use(express.json());
  app.use('/', authRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. TEST: Unauthenticated session verification attempt (legacy localStorage string)
    console.log('--- TEST 1: Unauthenticated session verification attempt ---');
    const res1 = await fetch(`${baseUrl}/auth/verify-session`, {
      headers: { 'Authorization': 'Bearer fake_legacy_email_string@domain.com' }
    });
    const status1 = res1.status;
    const body1 = await res1.json();
    console.log(`Status Code: ${status1}`);
    console.log(`Response Body: ${JSON.stringify(body1)}`);
    if (status1 === 401 && body1.ok === false) {
      console.log('✓ PASS: Legacy email string in localStorage rejected with 401 Unauthorized.\n');
    } else {
      throw new Error(`TEST 1 FAILED: Expected 401 Unauthorized, got ${status1}`);
    }

    // 2. TEST: URL Query parameter token rejection (req.query.token disabled)
    console.log('--- TEST 2: Rejection of query string tokens (URL token leak protection) ---');
    const res2 = await fetch(`${baseUrl}/auth/verify-session?token=some_token`);
    const status2 = res2.status;
    console.log(`Status Code: ${status2}`);
    if (status2 === 401) {
      console.log('✓ PASS: Query string token rejected (Authorization header required).\n');
    } else {
      throw new Error(`TEST 2 FAILED: Expected 401 Unauthorized for URL token, got ${status2}`);
    }

    // 3. TEST: Unauthenticated POST /auth/claim attempt
    console.log('--- TEST 3: Unauthenticated POST /auth/claim attempt ---');
    const res3 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAccountId: 'attempt_123', toAccountId: 'admin' })
    });
    const status3 = res3.status;
    const body3 = await res3.json();
    console.log(`Status Code: ${status3}`);
    console.log(`Response Body: ${JSON.stringify(body3)}`);
    if (status3 === 401) {
      console.log('✓ PASS: Unauthenticated /auth/claim request blocked with 401 Unauthorized.\n');
    } else {
      throw new Error(`TEST 3 FAILED: Expected 401 Unauthorized, got ${status3}`);
    }

    // Register authentic sessions in router._webSessions memory
    const validDispAToken = 'valid_session_token_dispatcher_A';
    authRouter._webSessions.set(validDispAToken, {
      email: 'alice@haulbox.com',
      accountId: 'login_attempt_dispA',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });

    const validSteveToken = 'valid_session_token_steve';
    authRouter._webSessions.set(validSteveToken, {
      email: 'stevesmith@gmail.com',
      accountId: 'login_attempt_steve',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });

    const validAttackerToken = 'valid_session_token_attacker';
    authRouter._webSessions.set(validAttackerToken, {
      email: 'attacker@gmail.com',
      accountId: 'login_attempt_attacker',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });

    const validAdminToken = 'valid_session_token_admin_1';
    authRouter._webSessions.set(validAdminToken, {
      email: 'haulbox2361@gmail.com',
      accountId: 'login_attempt_admin',
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });

    // 4. TEST: Authentic Dispatcher Token attempting unauthorized claim of Admin account
    console.log('--- TEST 4: Authentic Dispatcher token attempting unauthorized claim of Admin account ---');
    await store.set('login_attempt_dispA', { email: 'alice@haulbox.com', tokens: {} });
    const res4 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validDispAToken}`
      },
      body: JSON.stringify({ fromAccountId: 'login_attempt_dispA', toAccountId: 'admin' })
    });
    const status4 = res4.status;
    const body4 = await res4.json();
    console.log(`Status Code: ${status4}`);
    console.log(`Response Body: ${JSON.stringify(body4)}`);
    if (status4 === 403 && body4.error.includes('Forbidden')) {
      console.log('✓ PASS: Authentic Dispatcher token CANNOT claim Admin account (Blocked with 403 Forbidden).\n');
    } else {
      throw new Error(`TEST 4 FAILED: Expected 403 Forbidden, got ${status4}`);
    }

    // 5. TEST: Dispatcher A with GENUINE fromAccountId attempting claim of Dispatcher B account
    console.log('--- TEST 5: Dispatcher A with GENUINE fromAccountId attempting claim of Dispatcher B account ---');
    const genuineFromIdA = 'genuine_oauth_attempt_dispA';
    await store.set(genuineFromIdA, { email: 'alice@haulbox.com', tokens: { access_token: 'valid_oauth_A' } });

    const res5 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validDispAToken}`
      },
      body: JSON.stringify({ fromAccountId: genuineFromIdA, toAccountId: 'disp-B' })
    });
    const status5 = res5.status;
    const body5 = await res5.json();
    console.log(`Status Code: ${status5}`);
    console.log(`Response Body: ${JSON.stringify(body5)}`);
    if (status5 === 403 && body5.error.includes('Forbidden')) {
      console.log('✓ PASS: Dispatcher A with genuine fromAccountId CANNOT claim Dispatcher B account (Blocked with 403 Forbidden - Destination Mismatch).\n');
    } else {
      throw new Error(`TEST 5 FAILED: Expected 403 Forbidden, got ${status5}`);
    }

    // 6. TEST: Dispatcher A with GENUINE fromAccountId attempting claim of UNRESOLVABLE / NON-EXISTENT toAccountId
    console.log('--- TEST 6: Dispatcher A with GENUINE fromAccountId attempting claim of UNRESOLVABLE / NON-EXISTENT toAccountId ---');
    const res6 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validDispAToken}`
      },
      body: JSON.stringify({ fromAccountId: genuineFromIdA, toAccountId: 'non_existent_unresolvable_dispatcher_id' })
    });
    const status6 = res6.status;
    const body6 = await res6.json();
    console.log(`Status Code: ${status6}`);
    console.log(`Response Body: ${JSON.stringify(body6)}`);
    if (status6 === 403 && body6.error.includes('Forbidden')) {
      console.log('✓ PASS: Dispatcher A CANNOT claim unresolvable/non-existent target ID (Blocked with 403 Forbidden - Fail Closed Destination Resolution).\n');
    } else {
      throw new Error(`TEST 6 FAILED: Expected 403 Forbidden, got ${status6}`);
    }

    // 7. NEW TEST: Dispatcher matching primary email (d.email) ONLY -> Claim succeeds
    console.log('--- TEST 7: Dispatcher matching primary email (d.email) ONLY -> Claim succeeds ---');
    const genuineFromIdAlice = 'genuine_oauth_attempt_alice';
    await store.set(genuineFromIdAlice, { email: 'alice@haulbox.com', tokens: { access_token: 'alice_tokens' } });
    const res7 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validDispAToken}`
      },
      body: JSON.stringify({ fromAccountId: genuineFromIdAlice, toAccountId: 'disp-A' })
    });
    const status7 = res7.status;
    const body7 = await res7.json();
    console.log(`Status Code: ${status7}`);
    console.log(`Response Body: ${JSON.stringify(body7)}`);
    if (status7 === 200 && body7.ok === true) {
      console.log('✓ PASS: Dispatcher matching d.email ONLY successfully claims account (200 OK).\n');
    } else {
      throw new Error(`TEST 7 FAILED: Expected 200 OK, got ${status7}`);
    }

    // 8. NEW TEST: Dispatcher matching googleAccountEmail ONLY (Steve Smith case) -> Claim succeeds
    console.log('--- TEST 8 (Steve Smith Fix): Dispatcher matching googleAccountEmail ONLY -> Claim succeeds ---');
    const genuineFromIdSteve = 'genuine_oauth_attempt_steve';
    await store.set(genuineFromIdSteve, { email: 'stevesmith@gmail.com', tokens: { access_token: 'steve_tokens' } });
    const res8 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validSteveToken}`
      },
      body: JSON.stringify({ fromAccountId: genuineFromIdSteve, toAccountId: 'disp-Steve' })
    });
    const status8 = res8.status;
    const body8 = await res8.json();
    console.log(`Status Code: ${status8}`);
    console.log(`Response Body: ${JSON.stringify(body8)}`);
    if (status8 === 200 && body8.ok === true) {
      console.log('✓ PASS: Dispatcher matching googleAccountEmail ONLY (Steve Smith case) successfully claims account (200 OK).\n');
    } else {
      throw new Error(`TEST 8 FAILED: Expected 200 OK, got ${status8}`);
    }

    // 9. NEW TEST: Attacker matching neither d.email nor d.googleAccountEmail -> Blocked with 403
    console.log('--- TEST 9: Attacker matching neither d.email nor d.googleAccountEmail -> Blocked 403 ---');
    const genuineFromIdAttacker = 'genuine_oauth_attempt_attacker';
    await store.set(genuineFromIdAttacker, { email: 'attacker@gmail.com', tokens: { access_token: 'attacker_tokens' } });
    const res9 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validAttackerToken}`
      },
      body: JSON.stringify({ fromAccountId: genuineFromIdAttacker, toAccountId: 'disp-Steve' })
    });
    const status9 = res9.status;
    const body9 = await res9.json();
    console.log(`Status Code: ${status9}`);
    console.log(`Response Body: ${JSON.stringify(body9)}`);
    if (status9 === 403 && body9.error.includes('Forbidden')) {
      console.log('✓ PASS: Attacker matching neither field on Steve Smith record BLOCKED with 403 Forbidden.\n');
    } else {
      throw new Error(`TEST 9 FAILED: Expected 403 Forbidden, got ${status9}`);
    }

    // 10. TEST: Legitimate Admin Token claiming Admin account
    console.log('--- TEST 10: Legitimate Admin token claiming Admin account with matching OAuth state ---');
    await store.set('login_attempt_admin', { email: 'haulbox2361@gmail.com', tokens: { access_token: 'mock_oauth_tokens' } });
    const res10 = await fetch(`${baseUrl}/auth/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validAdminToken}`
      },
      body: JSON.stringify({ fromAccountId: 'login_attempt_admin', toAccountId: 'admin' })
    });
    const status10 = res10.status;
    const body10 = await res10.json();
    console.log(`Status Code: ${status10}`);
    console.log(`Response Body: ${JSON.stringify(body10)}`);
    if (status10 === 200 && body10.ok === true) {
      console.log('✓ PASS: Legitimate Admin token cleanly authorized for Admin account claim (200 OK).\n');
    } else {
      throw new Error(`TEST 10 FAILED: Expected 200 OK, got ${status10}`);
    }

    console.log('================================================================================');
    console.log('✅ STANDALONE SECURITY HOTFIX TEST COMPLETE: ALL 10 SECURITY ASSERTS PASSED!');
    console.log('================================================================================\n');

  } finally {
    server.close();
  }
}

runAuthHotfixTest().catch(err => {
  console.error('❌ AUTH HOTFIX TEST FAILED:', err);
  process.exit(1);
});
