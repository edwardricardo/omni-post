---
feature: first-administrator
owner: Maintainer
status: live
verified:
  sha: <VERIFIED-SHA>
  date: 2026-11-20
  by: Maintainer
paths:
  - apps/api/src/cli/createFirstAdministrator.ts
  - apps/api/src/cli/firstAdministratorCommand.ts
  - apps/api/src/infrastructure/container/firstAdministratorProcess.ts
  - apps/api/src/infrastructure/container/firstAdministratorComposition.ts
  - packages/core/auth/src/CreateFirstAdministratorUseCase.ts
  - packages/core/auth/src/ReissueAdministratorPasswordUseCase.ts
  - packages/core/auth/src/singleUsePassword.ts
  - packages/shared/src/error-registry/domains/auth.ts
  - packages/shared/src/error-registry/domains/platform.ts
  - apps/api/src/admin/auth/adminAuthRoutes.ts
  - apps/api/src/admin/auth/AdminAuthService.ts
  - apps/api/src/admin/auth/PasswordService.ts
  - apps/api/src/auth/authRoutes.ts
  - apps/api/src/auth/authServiceCore.ts
  - apps/admin/app/actions/auth.ts
  - apps/admin/lib/auth/
covers:
  - Create the first administrator of a new installation
  - Set a new password at the first sign-in
  - Re-issue a single-use password nobody saw
legal:
  - register:4
  - register:5
  - register:8
  - personal-data:details
---

# The first administrator

## What it does for the user

A new installation has no administrator, so nobody can sign in to the administration portal. An operator creates the first one with a command run where the API runs; the command prints the administrator's e-mail and a single-use password, once. At the first sign-in the administrator is sent to a page that sets a new password, and no session opens until it is set. When nobody saw a single-use password, the operator re-issues it with the same command, for the first administrator or any other administrator who is active, has never signed in and must still change the password.

## How it works end to end

### 1. The operator creates the first administrator

The command runs in the API's environment, with its standard output on an interactive terminal:

```bash
# In a container of the API's image, from its working directory /app
docker exec -it <container> /nodejs/bin/node dist/cli/createFirstAdministrator.js --email admin@example.com

# From a checkout, in apps/api
pnpm --silent create-first-admin --email admin@example.com
```

The entry `createFirstAdministrator.ts` hands its arguments to `runFirstAdministratorCommand` (`firstAdministratorCommand.ts`), which reads them and checks the terminal before it loads anything. Only then does it load `openFirstAdministratorCommand` (`firstAdministratorProcess.ts`), which validates the API's environment, check that the database answers a `SELECT 1`, and run `CreateFirstAdministratorUseCase`:

1. The e-mail is trimmed and lower-cased, and refused unless the administrators' sign-in accepts it.
2. A single-use password is drawn and hashed.
3. One transaction writes the `SUPER_ADMIN` role (id `role-super-admin`), refuses when any administrator exists, creates one `AdminUser` named after the e-mail's local part with `mustChangePassword` true, and writes one audit row, `FIRST_ADMINISTRATOR_CREATED`.

On success the terminal shows, and exit code is 0:

```text
The first administrator was created.

  E-mail:              admin@example.com
  Single-use password: <shown here once>

The password is shown this once and is stored nowhere: only its hash is kept.
Sign in with it now and change it at once.
```

Every other outcome goes to standard error, and its last line is `Code: <CODE>`, the registry's code for that refusal or failure, the one a ticket quotes. Each text is the registry's for its code (`packages/shared/src/error-registry/domains/auth.ts` and `platform.ts`), never an error's own message: a conflict or a not-found prints `Refused:`, a failure prints `Failed:` and the class and code of each cause, never a cause's message. `--help` prints the full rules.

| Exit      | Standard error shows                                                                                                                                                                                                                                                                                                                                                                                            | What it means                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | `Refused: An administrator already exists: the first administrator is created only on a database that has none`, then `Code: ADMINISTRATOR_ALREADY_EXISTS`                                                                                                                                                                                                                                                      | The database has an administrator; nothing was written                                                                                                                |
| 1         | `Refused: Another run of this command wrote the administration role first: check whether an administrator exists`, then `Code: ADMINISTRATION_ROLE_WRITTEN_BY_ANOTHER_RUN`                                                                                                                                                                                                                                      | Two runs at once, and the other one won                                                                                                                               |
| 1         | `Refused: A role with the administration role's name exists under another id, so every run of this command is refused until that role is renamed or removed`, then `Code: ADMINISTRATION_ROLE_NAME_HELD`                                                                                                                                                                                                        | A `SUPER_ADMIN` role exists with an id other than `role-super-admin`                                                                                                  |
| 1         | `Failed: The transaction that creates the first administrator failed and its outcome is unknown: the administrator may have been created without its password being shown, so check whether an administrator exists before running the command again, and when one exists whose password nobody saw, re-issue its single-use password`, then its `Cause:` lines and `Code: FIRST_ADMINISTRATOR_OUTCOME_UNKNOWN` | The database may hold an administrator whose password nobody saw: see section 3                                                                                       |
| 1         | `Failed: creating the first administrator stopped without an answer, so whether it was created is not known: check whether an administrator exists before running it again, and when one exists whose password nobody saw, run this command with --reissue and the same --email.`, then its `Cause:` lines and `Code: FIRST_ADMINISTRATOR_NO_ANSWER`                                                            | The same unknown outcome, reached another way                                                                                                                         |
| 1         | `Failed: The database cannot be reached: no connection could be opened, and nothing was read or written`, then its `Cause:` lines and `Code: DATABASE_UNREACHABLE`                                                                                                                                                                                                                                              | Nothing answers at the address `DATABASE_URL` names, which the command checks before any use case runs; nothing was read or written, and the address is never printed |
| 1         | `Failed: The environment was refused: these variables are missing or not valid: <names>`, then `Cause: Error` and `Code: ENV_VARIABLES_REFUSED`                                                                                                                                                                                                                                                                 | The API's environment misses each named variable or holds a value its schema refuses; the names are printed, never a value; nothing was written                       |
| 1         | `Failed: the command could not be set up in this environment; it must run in the API's environment.`, then its `Cause:` lines and `Code: FIRST_ADMIN_COMMAND_SETUP_FAILED`                                                                                                                                                                                                                                      | Loading the command's composition failed for another reason; nothing was written                                                                                      |
| unchanged | `Failed: Closing the database connection failed.`, then its `Cause:` lines and `Code: FIRST_ADMIN_COMMAND_CLOSE_FAILED`, after the outcome of a run that passed the setup (never after a usage error, the terminal refusal or a setup failure)                                                                                                                                                                  | The outcome printed before it stands; only the release of the connection failed, and the exit code is the outcome's                                                   |
| 1         | `Failed: <what failed>`, then one `Cause: <class>` line per cause (with `, code <CODE>` when it has one) and `Code: <CODE>`                                                                                                                                                                                                                                                                                     | A step failed and its transaction rolled back; a cause's own message is never printed                                                                                 |
| 2         | `This command prints a single-use password, so it runs only in an interactive terminal: …`, then `Code: FIRST_ADMIN_COMMAND_OUTPUT_NOT_A_TERMINAL`                                                                                                                                                                                                                                                              | Standard output went to a pipe or a file, or `docker exec` ran without `-it`                                                                                          |
| 2         | `The e-mail is not an address the administrators' sign-in accepts` or `The e-mail has no local part to name the administrator after`, then the usage and `Code: ADMINISTRATOR_EMAIL_INVALID` or `Code: ADMINISTRATOR_EMAIL_HAS_NO_LOCAL_PART`                                                                                                                                                                   | The address is refused before anything is written                                                                                                                     |
| 2         | One of the argument errors (for example `The e-mail of the administrator to create is required.`), then `Usage: create-first-admin --email <address> [--reissue]` and its code (for example `Code: FIRST_ADMIN_COMMAND_EMAIL_MISSING`)                                                                                                                                                                          | The arguments are wrong                                                                                                                                               |

### 2. The administrator signs in for the first time

The single-use password is right, but the password is marked to be changed. Both password sign-ins run every check (the e-mail, the active flag, the password, the second factor) and then refuse, with no session, no token and no sign-in date:

- `POST /admin/auth/login`, the administration portal's sign-in (`AdminAuthService.login`), answers 403 `{ "ok": false, "error": "PASSWORD_CHANGE_REQUIRED" }`.
- `POST /auth/login` (`AuthServiceCore.login`) answers 403 `{ "ok": false, "error": "Password change required" }`.

In the portal, `loginAction` (`apps/admin/app/actions/auth.ts`) reads that answer through `authenticateAdmin` (`apps/admin/lib/auth/backend-client.ts`) and opens the page `/<locale>/login/change-password`, with nothing in the URL. The sign-in form shows no message. The page reads:

> **Set a new password**
>
> This account must change its password before it can sign in. Enter the e-mail address, the current password and a new password. No session is opened here: once the password is changed, sign in with the new one.

Its fields are **E-mail address**, **Current password** (the single-use one), **New password** and **Confirm the new password**, and **Authentication code** once the API asks for it. The button reads **Change password**, and **Changing password...** while it waits. Under the new password the page lists the rules, after the line "The new password must:":

- be 12 to 128 characters long
- contain at least one lowercase letter
- contain at least one uppercase letter
- contain at least one number
- contain at least one character that is neither a letter nor a number
- differ from the current password and from the last 5 passwords of the account

The form refuses a confirmation that differs before anything is sent. Otherwise `changeRequiredPasswordAction` calls `POST /admin/auth/password/change-required`. There `AdminAuthService.changeRequiredPassword` checks the policy, runs the sign-in's checks and requires the mark; `PasswordService.replaceRequiredPassword` refuses a reused password, replaces the password and clears the mark in one guarded write, and ends every session of the administrator; then `AdminAuthService.changeRequiredPassword` writes the audit row `PASSWORD_CHANGED`. The portal then opens the sign-in with `?passwordChanged=1`, which shows "The password was changed. Sign in with the new password." The new password signs in normally.

What the page shows for each answer (English catalog, `apps/admin/messages/en.json`):

| Answer                         | The page shows                                                                                                      | Usually because                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (the form's own check)         | The new password and its confirmation do not match.                                                                 | The two new-password fields differ                                                                                                                                                                        |
| `INVALID_CREDENTIALS`          | The e-mail address or the password is not correct.                                                                  | Unknown e-mail, or the current password is not the single-use one                                                                                                                                         |
| `MFA_REQUIRED`                 | This account uses two-step verification. Enter the code from the authentication app.                                | The administrator has a second factor; the code field appears                                                                                                                                             |
| `MFA_INVALID`                  | The authentication code is not valid. Enter a new code.                                                             | Wrong or already used code                                                                                                                                                                                |
| `ACCOUNT_LOCKED`               | This account is locked. Try again later.                                                                            | Too many failed attempts on this account, or a lock set on the administrator's row (`lockedUntil`), which no path of the product writes today (ADMIN-MANUAL-LOCK-HAS-NO-WRITER)                           |
| `ACCOUNT_INACTIVE`             | This account is inactive.                                                                                           | The administrator was deactivated                                                                                                                                                                         |
| `PASSWORD_CHANGE_NOT_REQUIRED` | This account does not need a password change. Sign in with its password.                                            | The password was already changed                                                                                                                                                                          |
| `CONCURRENT_MODIFICATION`      | The account changed while the password was being saved. Try again.                                                  | Another write changed the administrator between the read and the write                                                                                                                                    |
| `PASSWORD_TOO_WEAK`            | The new password does not meet the requirements listed under it.                                                    | The new password breaks a rule of the list                                                                                                                                                                |
| `PASSWORD_REUSED`              | The new password cannot be the current password or one of the last 5. Choose another one.                           | The new password is the single-use one or a recent one                                                                                                                                                    |
| `RATE_LIMIT_EXCEEDED`          | Too many attempts. Wait a moment and try again.                                                                     | Too many requests from one address (about 15 a minute), or too many failed attempts                                                                                                                       |
| `IP_NOT_ALLOWED`               | Access from this network address is not allowed.                                                                    | The IP allowlist of the security settings is on and the caller's address is not in it: the sign-in is exempt from it, the change is not (ADMIN-AUTH-ROUTES-EXEMPT-FROM-THE-IP-ALLOWLIST-WITHOUT-A-REASON) |
| Validation failure             | Some fields are not valid., then one line per field (for example "Enter a new password of at most 128 characters.") | A field is empty, the e-mail is malformed, or the code is not 6 digits                                                                                                                                    |
| Any other answer, or none      | The request could not be completed. Try again.                                                                      | The API failed or could not be reached                                                                                                                                                                    |

### 3. Re-issuing a single-use password nobody saw

When the creation's output was lost, or it ended with an unknown outcome, the operator runs the same command with `--reissue`:

```bash
pnpm --silent create-first-admin --reissue --email admin@example.com
```

The same command serves any other administrator who is active, has never signed in and is still marked to change the password. Every administrator another administrator creates is marked, whether its password was generated or supplied, so when that password is lost before the new administrator has signed in or changed it, the operator re-issues one the same way, with that administrator's e-mail. An administrator who changed the required password is no longer marked, even before its first sign-in, and is refused, as a deactivated one is.

`ReissueAdministratorPasswordUseCase` serves any administrator, the first one or another, who exists, is active, has never signed in (`lastLoginAt` is empty) and must still change the password. The mode is not limited to the first administrator, by decision of the Product Owner: whoever runs the command already holds the server and the database, and the two conditions, never signed in and still marked, keep it away from a password an administrator chose for itself; a password another administrator supplied at the creation is replaced like a generated one. In one transaction it replaces the password, clears a pending password reset, ends every session of the administrator and writes the audit row `ADMINISTRATOR_PASSWORD_REISSUED`. The mark stays, so the new password must be changed at the first sign-in too. Exit code 0 and:

```text
A new single-use password was issued.

  E-mail:              admin@example.com
  Single-use password: <shown here once>

The password is shown this once and is stored nowhere: only its hash is kept.
The previous single-use password no longer works, and every session of this administrator was ended.
Sign in with it now and change it at once.
If the sign-in answers that the account is locked, the lock that failed sign-ins set is still in place: it ends by itself within 30 minutes.
```

The last line is there because the command opens no Redis connection: it neither reads nor clears a lock that failed sign-ins set, and that lock outlives the re-issue for 30 minutes at most.

A refused re-issue ends with exit code 1 and replaces nothing; the refusal's code follows it on its own line:

| Standard error shows                                                                                                                                                                                                                                                                                  | What it means                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Refused: No administrator has this e-mail: there is no single-use password to re-issue`, then `Code: ADMINISTRATOR_NOT_FOUND`                                                                                                                                                                        | The address is not an administrator's; check its spelling. Nothing changed                                                                                                                                                                                                                                                                                                                               |
| `Refused: This administrator has signed in, so its password is no longer a single-use password nobody saw: it is not re-issued`, then `Code: PASSWORD_REISSUE_REFUSED_SIGNED_IN`                                                                                                                      | The administrator holds a password of its own; this command does not serve it. Nothing changed and that password still works                                                                                                                                                                                                                                                                             |
| `Refused: This administrator is not marked to change its password, so its password is its own and not a single-use password: it is not re-issued`, then `Code: PASSWORD_REISSUE_REFUSED_NOT_MARKED`                                                                                                   | The password is the administrator's own: already changed, or set another way, as by the development seed. Nothing changed and that password still works                                                                                                                                                                                                                                                  |
| `Refused: This administrator is deactivated, so no password lets it sign in: it must be reactivated first, and its password is not re-issued`, then `Code: PASSWORD_REISSUE_REFUSED_DEACTIVATED`                                                                                                      | The administrator is inactive, so no password would let it sign in. Nothing changed; reactivate it first                                                                                                                                                                                                                                                                                                 |
| `Refused: The administrator changed between the read and the write (another re-issue, a password change, a requested password reset, a sign-in or a deactivation), so nothing was replaced: run the re-issue again to see what is true now`, then `Code: PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ` | Another write won between the re-issue's read and its write. Whether the previous password still works depends on which: after another re-issue or a password change it does not, after a requested password reset or a sign-in it does, and after a deactivation it is unchanged but no password lets the administrator sign in until it is reactivated. Run the re-issue again to see what is true now |

When the re-issue's outcome is unknown, standard error shows `Failed: The transaction that re-issues the single-use password failed and its outcome is unknown: the password may have been replaced without the new one being shown, so run the re-issue again` (`Code: PASSWORD_REISSUE_OUTCOME_UNKNOWN`) or `Failed: re-issuing the single-use password stopped without an answer, so whether it was replaced is not known: run this command again with --reissue and the same --email.` (`Code: PASSWORD_REISSUE_NO_ANSWER`). Both are answered by running the re-issue again.

A step that fails is reported as `Failed:` with the step, then its `Cause:` lines and its `Code:` line, with exit code 1. The read and the drawing and hashing of the password come before the transaction, and every later step rolls it back, so after any of these nothing was replaced and the previous password still works; the operator runs the re-issue again, and escalates to the Maintainer when the same step fails again:

- `Failed: Reading the administrator failed` (`ADMINISTRATOR_READ_FAILED`)
- `Failed: Generating the single-use password failed` (`SINGLE_USE_PASSWORD_GENERATE_FAILED`) or `Failed: Hashing the single-use password failed` (`SINGLE_USE_PASSWORD_HASH_FAILED`)
- `Failed: Replacing the single-use password failed` (`SINGLE_USE_PASSWORD_REPLACE_FAILED`)
- `Failed: Ending the administrator's sessions failed` (`ADMINISTRATOR_SESSIONS_REVOKE_FAILED`)
- `Failed: Writing the audit record of the re-issue failed` (`PASSWORD_REISSUE_AUDIT_WRITE_FAILED`)
- `Failed: A step inside the transaction failed; the transaction was rolled back and nothing was written` (`SINGLE_USE_PASSWORD_STEP_RAISED`)

`Failed: Closing the database connection failed.` can follow the outcome of any run of either mode that passed the setup, as in the creation's table. `Failed: The database cannot be reached` (`DATABASE_UNREACHABLE`) can end a run of either mode before its use case runs, and the environment's refusal (`ENV_VARIABLES_REFUSED`) before the setup ends, as in the same table.

### 4. What is recorded, and what never is

| Event                               | `AuditLog` row                                                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation                            | `action` `FIRST_ADMINISTRATOR_CREATED`, `actorType` `SYSTEM` with no user, `resource` `AdminUser`, `resourceId` the administrator's id, `details` `{ "task": "create-first-admin" }`                                                              |
| Re-issue                            | `action` `ADMINISTRATOR_PASSWORD_REISSUED`, the same fields, `details` `{ "task": "create-first-admin --reissue" }`                                                                                                                               |
| Refused sign-in, portal             | `action` `LOGIN_FAILED`, `resource` `AdminAuth`, `userId` the administrator, `success` false, `error` `PASSWORD_CHANGE_REQUIRED`, the caller's address and user agent                                                                             |
| Refused sign-in, `POST /auth/login` | `action` `USER_LOGIN`, `userId` the administrator, `success` false, `error` `PASSWORD_CHANGE_REQUIRED`, `details` with the e-mail, the reason and, when Redis is available, a hash of the device fingerprint, the caller's address and user agent |
| Password changed on the page        | `action` `PASSWORD_CHANGED`, `resource` `AdminAuth`, `userId` the administrator                                                                                                                                                                   |

These write no `AuditLog` row: a refused or failed creation and a refused or failed re-issue, which roll their transaction back or stop before it (an unknown outcome may have committed, with its row); and the refusals of the required change (the policy, the sign-in's checks, an administrator not marked, a reused password, a lost write), with one exception: a second factor's code that was already used leaves a row, `MFA_TOTP_REPLAY_REJECTED` or `MFA_BACKUP_CODE_REUSE_REJECTED`. A failure of the sign-in's checks other than a lock, the gate's own refusal or a missing second factor is counted as a failed attempt by the brute-force gate instead.

The creation and re-issue rows say what and when, never who ran the command: the command does not know the person on the host. No audit row, log or trace holds the single-use password or its hash. The command writes nothing to a logger and starts no tracing; the password appears only on the operator's terminal, and only its Argon2id hash is stored, in `AdminUser.passwordHash`.

## Where to look when a ticket opens

**Identify the request.** The command leaves no log line: what the operator saw on the terminal is the only record of a run, so ask for it; its last line, `Code: <CODE>`, names the refusal or the failure, and the tables of sections 1 and 3 give its meaning. In the API, each refusal the sign-ins and the required change answer through `BaseRouteHandler.sendError` is logged with the route name (`admin-auth` or `auth`), the method, the URL and the refusal as `message`; the 429 of the request limit is not.

**Metrics.** None. No series counts the command's runs, the refusals or the changes.

**Admin screens.** Two pages show part of it, and neither can be used while the only administrator cannot sign in.

- **Logs** (`apps/admin/app/[locale]/(dashboard)/logs/page.tsx`) lists audit rows, most recent first, through `GET /admin/audit/logs` (`apps/api/src/audit/auditRoutes.ts`), which needs the permission `AUDIT_READ`: each row's action, resource, result, address and time, with filters on text, action, result, administrator and dates. Read, not run: the API's query (`AuditService.getLogs`, `apps/api/src/audit/auditService.ts`) does not filter on the actor, so the creation's and the re-issue's system rows are among those it returns.
- **Users** (`apps/admin/app/[locale]/(dashboard)/users/page.tsx`) shows each administrator's last sign-in and whether it is active, not `mustChangePassword`.

**Database.** Over the owner channel:

```sql
-- The administrators and where each one stands
SELECT id, email, "isActive", "mustChangePassword", "lastLoginAt", "passwordChangedAt", "createdAt"
FROM "AdminUser" ORDER BY "createdAt";

-- The command's runs
SELECT action, "resourceId", details, "createdAt" FROM "AuditLog"
WHERE action IN ('FIRST_ADMINISTRATOR_CREATED', 'ADMINISTRATOR_PASSWORD_REISSUED') ORDER BY "createdAt";

-- Sign-ins refused because the password must be changed
SELECT action, "userId", "ipAddress", "createdAt" FROM "AuditLog"
WHERE error = 'PASSWORD_CHANGE_REQUIRED' ORDER BY "createdAt" DESC;
```

An administrator with `mustChangePassword` true and `lastLoginAt` empty has not set a password yet and, while `isActive` is true, is eligible for `--reissue`. `mustChangePassword` false means the administrator signs in with a password of its own: for the administrator the command created, the password was changed (or reset); the administrator the development seed creates is never marked, and every administrator another administrator creates, through either creation route and whether the password is generated or supplied, is marked.

**Queues and jobs.** None: nothing of this feature is queued.

**Provider side.** None: no third party takes part.

## Known failure modes

| The ticket looks like                                                    | Usually because                                                                                                                                                          | Check                                                                                              | Fix or escalate                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| "The command says an administrator already exists"                       | An earlier run, or the development seed, created one                                                                                                                     | The first query above                                                                              | Sign in as it; if active, never signed in, still marked, and its password lost, `--reissue --email <its address>` |
| "Nobody has the first administrator's password"                          | The output was lost, or the creation ended with an unknown outcome                                                                                                       | `isActive` and `mustChangePassword` true, `lastLoginAt` empty                                      | `--reissue --email <its address>`                                                                                 |
| "A new administrator never received its password"                        | The administrator who created it lost the single-use password it was given, and the new one has not signed in                                                            | `isActive` and `mustChangePassword` true, `lastLoginAt` empty                                      | `--reissue --email <its address>`                                                                                 |
| "The command will not run: not an interactive terminal"                  | Its output goes to a pipe or a file, or `docker exec` ran without `-it`                                                                                                  | The exact command line                                                                             | Run it again attached to a terminal                                                                               |
| "The command says the environment was refused"                           | The API's environment misses each variable the message names, or holds a value its schema refuses (`ENV_VARIABLES_REFUSED`); the command prints the names, never a value | Whether the API starts in the same environment: its start prints each variable with its constraint | Fix the named variables; otherwise escalate to the Maintainer                                                     |
| "The command says the database cannot be reached"                        | Nothing answers at the address `DATABASE_URL` names: the database is down, or the address is not the API's (`DATABASE_UNREACHABLE`); nothing was read or written         | Whether the API reaches the database in the same environment                                       | Start the database or correct `DATABASE_URL`, then run the command again; otherwise escalate to the Maintainer    |
| "The command could not be set up in this environment"                    | Loading the command's composition failed for a reason other than the environment (`FIRST_ADMIN_COMMAND_SETUP_FAILED`)                                                    | The `Cause:` lines the command printed                                                             | Escalate to the Maintainer with the terminal's output                                                             |
| "The command refuses: a role with the administration role's name exists" | A `SUPER_ADMIN` role was written under another id                                                                                                                        | `SELECT id, name FROM "Role" WHERE name = 'SUPER_ADMIN';`                                          | Escalate to the Maintainer: the role must be renamed or removed                                                   |
| "Signing in sends me to Set a new password"                              | Expected: the password is the single-use one                                                                                                                             | —                                                                                                  | Complete the page, then sign in with the new password                                                             |
| "The page says the account does not need a password change"              | The password was already changed                                                                                                                                         | `mustChangePassword` is false                                                                      | Sign in with the new password                                                                                     |
| "My authentication code was refused right after another error"           | A refusal after the second factor spends its code; the order is deliberate, by decision of the Product Owner                                                             | —                                                                                                  | Enter a new code                                                                                                  |
| "After the re-issue the account is still locked"                         | A lock from failed sign-ins outlives a re-issue, and the command says so in its last line                                                                                | The page shows "This account is locked. Try again later."                                          | Wait for the lock to end, 30 minutes after it was set at most, then sign in                                       |
| "The re-issue refused: the administrator is deactivated"                 | The re-issue refuses a deactivated administrator, because no password would let it sign in                                                                               | `isActive` is false                                                                                | Escalate to the Maintainer: the administrator must be reactivated first                                           |
| "Too many attempts"                                                      | Too many requests from one address (about 15 a minute), or too many failed attempts                                                                                      | —                                                                                                  | Wait a minute and try again                                                                                       |

### What it does not do yet

These behaviors are accepted by decision of the Product Owner, so a support person meets them as they are:

- A session opened before an administrator is marked keeps working until it ends; whoever marks an existing administrator ends its sessions in the same write.
- A refusal that comes after the second factor has spent its code.
- `--reissue` serves any active administrator who has never signed in and must still change the password, not only the first one: whoever runs the command already holds the server and the database.

An administrator who has signed in and lost the password is not served by this command: the re-issue refuses it.

## Configuration

- **The command** has no setting of its own. It reads the API's typed env module (`apps/api/src/config/env.ts`), so it needs every variable the API needs at boot; from a checkout it reads the root `.env`. The `SUPER_ADMIN` role it writes is the definition in `infra/prisma/src/adminSystemRoles.ts`, which holds every permission.
- **The password policy** of the change (12 characters at least, the four character kinds, no reuse of the last 5) is code, `adminAuthConfig.passwordPolicy` (`apps/api/src/admin/auth/adminAuthConfig.ts`); the page states the same numbers from `apps/admin/lib/auth/passwordPolicy.ts`. No operator can change it.
- **The request limit** of 15 requests a minute per client address (100 under `NODE_ENV=test`), shared by the sign-in and the required change, is code (`apps/api/src/admin/auth/adminAuthRoutes.ts`).
- **The portal** reaches the API at `API_URL` (`apps/admin/lib/env.ts`).
- **The development seed** (`pnpm db:seed`) also creates an administrator, `admin@omnipost.local`, with the password `ADMIN_PASSWORD` and no mark. It runs only when `NODE_ENV` is `development` or `test`, or is unset, and refuses every other value, `staging` and an empty value included; it is never run against a production database. Each run sets the administrator's password again, as intended.

## Data and privacy

- An administrator's e-mail (`AdminUser.email`) is personal data: category `contact`, subject `admin-user`, in the [personal-data inventory](../legal/inventories/personal-data.generated.md). The name the command derives from it (`AdminUser.name`) and the password hash (`AdminUser.passwordHash`) are personal data too. The subjects and categories are [REGISTER.md §4](../legal/REGISTER.md#4-categories-of-data-subjects) and [§5](../legal/REGISTER.md#5-categories-of-personal-data).
- The creation and re-issue audit rows hold the administrator's id and the task, never the e-mail. A refused sign-in's row holds the administrator's id, address and user agent, and at `POST /auth/login` the e-mail too, in `details`, which the personal-data inventory classifies as personal (`AuditLog.details`).
- Audit rows are kept as [REGISTER.md §8](../legal/REGISTER.md#8-retention-and-erasure) and the [retention calendar](../compliance/RETENTION_CALENDAR.md) say.

## Related documents

- Endpoints: [API.md §Administrator Authentication](../architecture/API.md#administrator-authentication) and [§Login](../architecture/API.md#login).
- Deployment: the row "The first admin user" of [DEPLOYMENT_CHECKLIST.md §Infrastructure](../deployment/DEPLOYMENT_CHECKLIST.md#infrastructure).
- Development: [getting-started.md §The first administrator](../development/getting-started.md#the-first-administrator).
- Plan: F-02 in [chain.md](../product/plan/chain.md).

## Verification

Last verified against main <VERIFIED-SHA> on 2026-11-20 by Maintainer
