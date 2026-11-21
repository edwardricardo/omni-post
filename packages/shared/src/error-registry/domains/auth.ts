/**
 * @file auth.ts
 * @description The `auth` domain: the failures of administrators and their credentials.
 * @layer domain
 */
import { ERROR_CATEGORY, defineErrors } from "../definition.js";

export const AUTH_ERRORS = defineErrors("auth", {
  ADMINISTRATOR_EMAIL_INVALID: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The e-mail is not an address the administrators' sign-in accepts",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_EMAIL_HAS_NO_LOCAL_PART: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The e-mail has no local part to name the administrator after",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_ALREADY_EXISTS: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "An administrator already exists: the first administrator is created only on a database that has none",
    params: {},
    fronts: [],
  },
  ADMINISTRATION_ROLE_WRITTEN_BY_ANOTHER_RUN: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "Another run of this command wrote the administration role first: check whether an administrator exists",
    params: {},
    fronts: [],
  },
  ADMINISTRATION_ROLE_NAME_HELD: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "A role with the administration role's name exists under another id, so every run of this command is refused until that role is renamed or removed",
    params: {},
    fronts: [],
  },
  ADMINISTRATION_ROLE_WRITE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Writing the administration role failed",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_EXISTENCE_READ_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Reading whether an administrator exists failed",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_CREATE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Creating the administrator failed",
    params: {},
    fronts: [],
  },
  FIRST_ADMINISTRATOR_AUDIT_WRITE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Writing the audit record of the creation failed",
    params: {},
    fronts: [],
  },
  FIRST_ADMINISTRATOR_OUTCOME_UNKNOWN: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "The transaction that creates the first administrator failed and its outcome is unknown: the administrator may have been created without its password being shown, so check whether an administrator exists before running the command again, and when one exists whose password nobody saw, re-issue its single-use password",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_NOT_FOUND: {
    category: ERROR_CATEGORY.NOT_FOUND,
    status: 404,
    message: "No administrator has this e-mail: there is no single-use password to re-issue",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_REFUSED_SIGNED_IN: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "This administrator has signed in, so its password is no longer a single-use password nobody saw: it is not re-issued",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_REFUSED_NOT_MARKED: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "This administrator is not marked to change its password, so its password is its own and not a single-use password: it is not re-issued",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_REFUSED_DEACTIVATED: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "This administrator is deactivated, so no password lets it sign in: it must be reactivated first, and its password is not re-issued",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_REFUSED_CHANGED_SINCE_READ: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message:
      "The administrator changed between the read and the write (another re-issue, a password change, a requested password reset, a sign-in or a deactivation), so nothing was replaced: run the re-issue again to see what is true now",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_READ_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Reading the administrator failed",
    params: {},
    fronts: [],
  },
  SINGLE_USE_PASSWORD_REPLACE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Replacing the single-use password failed",
    params: {},
    fronts: [],
  },
  ADMINISTRATOR_SESSIONS_REVOKE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Ending the administrator's sessions failed",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_AUDIT_WRITE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Writing the audit record of the re-issue failed",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_OUTCOME_UNKNOWN: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "The transaction that re-issues the single-use password failed and its outcome is unknown: the password may have been replaced without the new one being shown, so run the re-issue again",
    params: {},
    fronts: [],
  },
  SINGLE_USE_PASSWORD_GENERATE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Generating the single-use password failed",
    params: {},
    fronts: [],
  },
  SINGLE_USE_PASSWORD_HASH_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Hashing the single-use password failed",
    params: {},
    fronts: [],
  },
  SINGLE_USE_PASSWORD_STEP_RAISED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "A step inside the transaction failed; the transaction was rolled back and nothing was written",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_EMAIL_MISSING: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The e-mail of the administrator to create is required.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_EMAIL_MISSING_FOR_REISSUE: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The e-mail of the administrator whose password to re-issue is required.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_OPTION_VALUE_INVALID: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "--email takes the administrator's address as its value, and --reissue and --help take none.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_OPTION_UNKNOWN: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "This command takes only --email <address>, --reissue and --help.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_EMAIL_REPEATED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "--email is given more than once.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_OUTPUT_NOT_A_TERMINAL: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message:
      "This command prints a single-use password, so it runs only in an interactive terminal: its standard output is not a terminal, and the password would be kept wherever that output goes. Run it again with its output on a terminal.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_SETUP_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "the command could not be set up in this environment; it must run in the API's environment.",
    params: {},
    fronts: [],
  },
  FIRST_ADMIN_COMMAND_CLOSE_FAILED: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "Closing the database connection failed.",
    params: {},
    fronts: [],
  },
  FIRST_ADMINISTRATOR_NO_ANSWER: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "creating the first administrator stopped without an answer, so whether it was created is not known: check whether an administrator exists before running it again, and when one exists whose password nobody saw, run this command with --reissue and the same --email.",
    params: {},
    fronts: [],
  },
  PASSWORD_REISSUE_NO_ANSWER: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message:
      "re-issuing the single-use password stopped without an answer, so whether it was replaced is not known: run this command again with --reissue and the same --email.",
    params: {},
    fronts: [],
  },
});
