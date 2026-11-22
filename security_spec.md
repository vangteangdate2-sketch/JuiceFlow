# JuiceFlow Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default-Deny Safety Net**: Every path not explicitly matched is denied for both read and write.
2. **Verified Identity**: All authenticated reads and writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Master Gate Membership**: Access to `/workspaces/{workspaceId}` and all single-document subcollection operations requires an active membership document at `/workspaces/{workspaceId}/members/{request.auth.uid}`.
4. **Secure List Queries**: Every `allow list` on subcollections evaluates `request.auth.uid in resource.data.memberUids` with zero `get()` or `exists()` lookups.
5. **PII Isolation**: `/users/{userId}` is strictly isolated to `request.auth.uid == userId`; `list` is forbidden.
6. **Temporal Integrity**: `createdAt` must equal `request.time` on creation and remain immutable on updates; `updatedAt` must equal `request.time` on updates.
7. **Terminal State Locking**: A `Sale` document with `status == 'voided'` is terminally locked and rejects any further mutation.
8. **Strict Key & Volumetric Guards**: Every document creation enforces `hasAll` + `hasOnly`, every string enforces `.size()`, every ID enforces `^[a-zA-Z0-9_\-]+$`, and every array enforces `.size() <= MAX`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Product Create**: Adding `isAdmin: true` to a valid `Product` create payload -> MUST return `PERMISSION_DENIED`.
2. **Unverified Email Spoofing**: Authenticated user with `email_verified: false` attempting to create a workspace -> MUST return `PERMISSION_DENIED`.
3. **Cross-User Profile Read (PII Leak)**: User B calling `get` on `/users/userA` -> MUST return `PERMISSION_DENIED`.
4. **Blanket List Scraping on Sales**: Non-member querying `/workspaces/ws1/sales` -> MUST return `PERMISSION_DENIED`.
5. **Identity Spoofing on Expense Create**: Member A creating an expense with `createdBy: "userB"` -> MUST return `PERMISSION_DENIED`.
6. **ID Poisoning**: Creating an ingredient with a 200-char or symbol-injected document ID (`../../evil`) -> MUST return `PERMISSION_DENIED`.
7. **Client Timestamp Forgery**: Creating a sale with a backdated client timestamp (`createdAt != request.time`) -> MUST return `PERMISSION_DENIED`.
8. **Immutable Field Tampering**: Updating a sale's `createdAt` or `workspaceId` -> MUST return `PERMISSION_DENIED`.
9. **Terminal State Violation (Voided Sale Revival)**: Attempting to update a `voided` sale back to `completed` -> MUST return `PERMISSION_DENIED`.
10. **Unauthorized Invite Code Membership Join**: Joining `/workspaces/ws1/members/attacker` with wrong `inviteCode` -> MUST return `PERMISSION_DENIED`.
11. **Oversized Array / String Exhaustion**: Creating a product with 25 recipe items (`> 20`) or a 500-char product name -> MUST return `PERMISSION_DENIED`.
12. **Stock Movement Mutation / Deletion**: Attempting to modify or delete an immutable `stockMovements` audit record -> MUST return `PERMISSION_DENIED`.
