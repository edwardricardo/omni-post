"use client";

/**
 * @file page.tsx
 * @description Registration page with email, name, and password form for new users.
 * @component RegisterPage
 * @layer infrastructure
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
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
} from "@packages/ui";
import { Alert, AlertDescription } from "@packages/ui";
import { Mail, Lock, User } from "lucide-react";
import { registerAction } from "@/app/actions/auth";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const [state, formAction] = useActionState(registerAction, null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">{t("registerTitle")}</CardTitle>
          <CardDescription className="text-center">{t("registerSubtitle")}</CardDescription>
        </CardHeader>

        <form action={formAction}>
          <CardContent className="space-y-4">
            {state?.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">{t("nameLabel")}</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder={t("namePlaceholder")}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t("emailLabel")}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t("passwordLabel")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  required
                  minLength={8}
                />
              </div>
              <p className="text-xs text-gray-500">{t("passwordHint")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("confirmPasswordLabel")}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  required
                  minLength={8}
                />
              </div>
            </div>

            <div className="flex items-start">
              <input
                id="terms"
                name="terms"
                type="checkbox"
                required
                className="h-4 w-4 rounded-sm border-gray-300 text-primary focus:ring-primary mt-1"
              />
              <Label htmlFor="terms" className="ml-2 block text-sm text-gray-700">
                {t.rich("termsAgreement", {
                  termsLink: (chunks) => (
                    <Link href="/terms" className="text-primary hover:underline">
                      {chunks}
                    </Link>
                  ),
                  privacyLink: (chunks) => (
                    <Link href="/privacy" className="text-primary hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </Label>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4">
            <SubmitButton className="w-full" pendingText={t("creatingAccount")}>
              {t("createAccount")}
            </SubmitButton>

            <p className="text-sm text-center text-gray-600">
              {t("haveAccount")}{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                {t("signIn")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
