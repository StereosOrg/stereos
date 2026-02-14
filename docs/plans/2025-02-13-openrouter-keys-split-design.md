# OpenRouter Keys: User vs Team Split – Design

## Overview

Split OpenRouter key provisioning into **user keys** and **team keys** with separate APIs, UI surfaces, and authorization rules.

---

## 1. API Changes

### Endpoints

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /v1/keys/user` | List keys for **current user** (user_id = me) | sessionOrTokenAuth |
| `POST /v1/keys/user` | Create key for **a user** (self or target user) | sessionOrTokenAuth + manager/admin; if target user, must be manager/admin |
| `DELETE /v1/keys/user/:hash` | Revoke user key | sessionOrTokenAuth + owner or manager/admin |
| `GET /v1/keys/team/:teamId` | List keys for **team** | sessionOrTokenAuth + team member |
| `POST /v1/keys/team/:teamId` | Create key for **team** | sessionOrTokenAuth + manager/admin **and** team member |
| `DELETE /v1/keys/team/:teamId/:hash` | Revoke team key | sessionOrTokenAuth + manager/admin + team member |

**Deprecate/remove:** `GET /v1/keys`, `POST /v1/keys`, `DELETE /v1/keys/:hash` (or keep as legacy, redirect internally).

### Authorization Rules

**User keys:**
- Create: Manager or Admin. If creating for another user (`user_id` in body), only managers/admins; the target user must be in the same customer.
- List (own): Any authenticated user sees keys where `user_id = me`.
- Revoke: Owner of the key (user_id = me) OR manager/admin.

**Team keys:**
- Create: Manager or Admin **and** must be a member of that team (`teamMembers` check).
- List: Only team members can list team keys.
- Revoke: Manager or Admin **and** team member.

### Schema Constraint

Enforce mutual exclusivity: a key must have either `user_id` OR `team_id`, not both, not neither (customer-level keys deprecated). Validation: `(user_id IS NOT NULL AND team_id IS NULL) OR (user_id IS NULL AND team_id IS NOT NULL)`.

---

## 2. UI Changes

### /settings

- **Replace** OpenRouter keys with a new section: **"OpenRouter keys (for you)"**.
- Show only keys where `user_id = current user` (from `GET /v1/keys/user`).
- No create form here: user keys are provisioned by managers.
- Revoke: users can revoke their own keys; managers/admins can revoke any user key (if we add a "provisioned for others" view for admins, optional).

### Team page (/teams/:teamId)

- Add section: **"Team OpenRouter keys"**.
- Fetch from `GET /v1/keys/team/:teamId`.
- **Create form:** Shown only to Manager/Admin who are **members of that team**.
- **Non-members:** Can view the team page (if allowed) but the keys section shows keys in a read-only, blurred/blocked state OR is hidden. Per your wording: "input is blocked out for users who aren't on the same team" — we’ll hide the create form and revoke controls for non-manager members; for non-members, hide or blur the keys section.
- **Revoke:** Only Manager/Admin + team member.

### User profile (/users/:userId)

- Add section: **"Provision OpenRouter key"** (only for managers/admins viewing another user).
- Create form: Manager/Admin can provision a key for that user.
- List: Show keys provisioned for that user (manager view).

### /keys page

- **Remove** or **redirect** to /settings. All user-scoped key display moves to /settings. Team-scoped keys live on team pages.

---

## 3. Navigation & Layout

- Remove **Keys** from the main nav (or keep and make it a redirect to /settings).
- User keys live under **Settings**.
- Team keys live under **Teams** → Team detail page.

---

## 4. Open Questions (for you)

1. **Where do managers create user keys for other users?**  
   Proposed: User profile page (`/users/:userId`) when viewing someone else. Is that correct?

2. **Non-team-member on team page:**  
   You said "input is blocked out for users who aren't on the same team." Should non-members:
   - (A) Not see the team page at all (403)?
   - (B) See the team page but the keys section is hidden?
   - (C) See the team page with keys section visible but create form + revoke hidden/blurred?

3. **/keys route:**  
   Remove from nav and redirect to /settings, or keep as a landing page that explains "User keys → Settings, Team keys → Team pages"?

---

## 5. Implementation Order

1. API: Add `GET/POST/DELETE` for user keys and team keys with new auth.
2. API: Enforce user_id XOR team_id on create.
3. Settings: Replace Keys integration with "OpenRouter keys (for you)" from user keys API.
4. TeamProfile: Add team keys section + create/revoke for manager/admin team members.
5. UserProfile: Add "Provision key" for managers viewing another user.
6. Remove or redirect /keys; update Layout nav.
7. Deprecate/remove old combined keys endpoints.

---

*Awaiting your answers to the open questions before implementation.*
