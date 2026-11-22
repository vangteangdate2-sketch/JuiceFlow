/**
 * Phase 0 TDD Security Rules Test Suite for JuiceFlow
 * Verifies all 12 Dirty Dozen adversarial payloads return PERMISSION_DENIED.
 * Intended to run against the Firebase Firestore Emulator (`@firebase/rules-unit-testing`).
 */

export const DIRTY_DOZEN_TEST_CASES = [
  {
    id: 1,
    name: 'Shadow field injection on product create',
    path: '/workspaces/ws_family/products/prod_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { isAdmin: true, name: 'Mango Juice' },
  },
  {
    id: 2,
    name: 'Unverified email spoofing on workspace create',
    path: '/workspaces/ws_spoof',
    operation: 'create',
    auth: { uid: 'u1', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-user PII profile read',
    path: '/users/user_a',
    operation: 'get',
    auth: { uid: 'user_b', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Blanket list scraping on sales by non-member',
    path: '/workspaces/ws_family/sales',
    operation: 'list',
    auth: { uid: 'outsider', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity spoofing on expense create (createdBy mismatch)',
    path: '/workspaces/ws_family/expenses/exp_1',
    operation: 'create',
    auth: { uid: 'member_a', email_verified: true },
    payload: { createdBy: 'member_b' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID poisoning on ingredient path variable',
    path: '/workspaces/ws_family/ingredients/invalid$id!with@chars',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Client timestamp forgery on sale creation',
    path: '/workspaces/ws_family/sales/sale_1',
    operation: 'create',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutable createdAt tampering on sale update',
    path: '/workspaces/ws_family/sales/sale_1',
    operation: 'update',
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal state violation (un-voiding a voided sale)',
    path: '/workspaces/ws_family/sales/sale_voided',
    operation: 'update',
    payload: { status: 'completed' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unauthorized workspace join with wrong inviteCode',
    path: '/workspaces/ws_family/members/attacker',
    operation: 'create',
    payload: { inviteCode: 'WRONG9' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Oversized recipe array exhaustion (> 20 items)',
    path: '/workspaces/ws_family/products/prod_overflow',
    operation: 'create',
    payload: { recipeLength: 25 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Deleting immutable stockMovement audit log',
    path: '/workspaces/ws_family/stockMovements/mov_1',
    operation: 'delete',
    expected: 'PERMISSION_DENIED',
  },
] as const;
