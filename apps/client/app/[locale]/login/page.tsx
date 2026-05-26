"use client";

/**
 * @file page.tsx
 * @component LoginPage
 * @description Login page with email/password authentication form.
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
import { Mail, Lock } from "lucide-react";
import { loginAction } from "@/app/actions/auth";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [state, formAction] = useActionState(loginAction, null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">{t("loginTitle")}</CardTitle>
          <CardDescription className="text-center">{t("loginSubtitle")}</CardDescription>
        </CardHeader>

        <form action={formAction}>
          <CardContent className="space-y-4">
            {state?.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

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
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="rememberMe"
                  type="checkbox"
                  className="h-4 w-4 rounded-sm border-gray-300 text-primary focus:ring-primary"
                />
                <Label
                  htmlFor="remember-me"
                  className="ml-2 block text-sm text-gray-700 cursor-pointer"
                >
                  {t("rememberMe")}
                </Label>
              </div>

              <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                {t("forgotPassword")}
              </Link>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4">
            <SubmitButton className="w-full" pendingText={t("signingIn")}>
              {t("signIn")}
            </SubmitButton>

            <p className="text-sm text-center text-gray-600">
              {t("noAccount")}{" "}
              <Link href="/register" className="font-medium text-primary hover:underline">
                {t("signUp")}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
