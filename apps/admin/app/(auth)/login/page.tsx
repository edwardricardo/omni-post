/**
 * @file page.tsx
 * @description Admin login page. Renders the LoginForm component which handles credential
 * submission and the optional MFA step via a Server Action.
 */
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return <LoginForm />;
}
