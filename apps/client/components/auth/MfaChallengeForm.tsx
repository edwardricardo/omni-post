"use client";

/**
 * @file MfaChallengeForm.tsx
 * @description Challenge (step 2) of the customer login MFA flow. Renders the
 *              verification-code input plus hidden challenge-token / remember-me
 *              inputs and submits them to `completeMfaLoginAction` via
 *              `useActionState`. The challenge token lives in React state and a
 *              hidden DOM input ONLY — never localStorage/sessionStorage (OWASP
 *              XSS exfiltration target). A wrong code keeps the challenge for
 *              retry; an invalid/expired challenge signals the parent to return
 *              to the password step.
 * @component MfaChallengeForm
 * @layer infrastructure
 */

import { useActionState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  SubmitButton,
  Input,
  Label,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Alert,
  AlertDescription,
} from "@packages/ui";
import { ShieldCheck } from "lucide-react";
import { completeMfaLoginAction, type MfaChallengeState } from "@/app/actions/auth";

export interface MfaChallengeFormProps {
  /**
   * Active challenge issued by step 1. The `challengeToken` is rendered into a
   * hidden input (memory/DOM only) and echoed back to the backend to complete
   * the login. Never persisted to browser storage.
   */
  challenge: MfaChallengeState;
  /**
   * Called when the challenge can no longer be completed (invalid / expired /
   * consumed, or the challenge store is unavailable) so the parent can return
   * to the password step and surface the message there.
   */
  onChallengeExpired: (message: string) => void;
}

export function MfaChallengeForm({ challenge, onChallengeExpired }: MfaChallengeFormProps) {
  const t = useTranslations("auth");
  const [state, formAction] = useActionState(completeMfaLoginAction, null);

  useEffect(() => {
    if (state?.mfaChallengeExpired) {
      onChallengeExpired(state.error ?? t("mfaChallengeExpired"));
    }
  }, [state, onChallengeExpired, t]);

  // A wrong code (retry) shows an inline error; an expired challenge is handled
  // by the effect above (parent returns to the password step), not inline.
  const showInlineError = Boolean(state?.error) && !state?.mfaChallengeExpired;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">{t("mfaTitle")}</CardTitle>
          <CardDescription className="text-center">{t("mfaSubtitle")}</CardDescription>
        </CardHeader>

        <form action={formAction}>
          <CardContent className="space-y-4">
            {showInlineError && (
              <Alert variant="destructive">
                <AlertDescription>{state?.error}</AlertDescription>
              </Alert>
            )}

            <input type="hidden" name="challengeToken" value={challenge.challengeToken} />
            <input type="hidden" name="rememberMe" value={challenge.rememberMe ? "on" : "off"} />

            <div className="space-y-2">
              <Label htmlFor="mfa-code">{t("mfaCodeLabel")}</Label>
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="mfa-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t("mfaCodePlaceholder")}
                  className="pl-10"
                  required
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4">
            <SubmitButton className="w-full" pendingText={t("mfaVerifying")}>
              {t("mfaVerify")}
            </SubmitButton>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
