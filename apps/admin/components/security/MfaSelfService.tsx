/**
 * @file MfaSelfService.tsx
 * @description Self-service MFA setup panel for the current admin user.
 * Allows setting up MFA via TOTP, verifying with a code, and disabling MFA.
 * @layer presentation
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "@packages/ui";
import { api } from "../../lib/apiClient";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

interface MfaSetupData {
  secret: string;
  otpauthUrl: string;
  qrCode: string;
}

export function MfaSelfService() {
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [backupCodesCount, setBackupCodesCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Setup flow
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Disable flow
  const [disableCode, setDisableCode] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await api.security.mfa.getStatus();
      if (response.ok) {
        setMfaEnabled(response.mfa.enabled);
        setBackupCodesCount(response.mfa.backupCodesCount);
      }
    } catch {
      // Status fetch failed — assume disabled
      setMfaEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleStartSetup = useCallback(async () => {
    try {
      setSetupLoading(true);
      const response = await api.security.mfa.setup();
      if (!response.ok) throw new Error("Failed to start MFA setup");
      const setup = response.setup as MfaSetupData;
      setSetupData(setup);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to start MFA setup",
        variant: "destructive",
      });
    } finally {
      setSetupLoading(false);
    }
  }, []);

  const handleVerify = useCallback(async () => {
    if (!verifyCode.trim()) {
      toast({
        title: "Validation",
        description: "Enter the 6-digit code from your authenticator app",
        variant: "destructive",
      });
      return;
    }
    try {
      setVerifyLoading(true);
      const response = await api.security.mfa.verifySetup(verifyCode.trim());
      if (!response.ok) throw new Error("Invalid code");
      setMfaEnabled(true);
      setBackupCodes(response.backupCodes);
      setSetupData(null);
      setVerifyCode("");
      toast({ title: "Success", description: "MFA enabled successfully" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to verify code",
        variant: "destructive",
      });
    } finally {
      setVerifyLoading(false);
    }
  }, [verifyCode]);

  const handleDisable = useCallback(async () => {
    if (!disableCode.trim()) {
      toast({
        title: "Validation",
        description: "Enter your current TOTP code to disable MFA",
        variant: "destructive",
      });
      return;
    }
    try {
      setDisableLoading(true);
      const response = await api.security.mfa.disable(disableCode.trim());
      if (!response.ok) throw new Error("Invalid code");
      setMfaEnabled(false);
      setBackupCodesCount(0);
      setDisableCode("");
      setShowDisable(false);
      toast({ title: "Success", description: "MFA disabled" });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to disable MFA",
        variant: "destructive",
      });
    } finally {
      setDisableLoading(false);
    }
  }, [disableCode]);

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
        <div className="animate-pulse">
          <div className="h-5 w-40 rounded bg-[var(--bg-elevated)] mb-3" />
          <div className="h-8 w-24 rounded bg-[var(--bg-elevated)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {mfaEnabled ? (
            <ShieldCheck className="h-4 w-4 text-[var(--success)]" />
          ) : (
            <ShieldOff className="h-4 w-4 text-[var(--text-tertiary)]" />
          )}
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Your MFA</h3>
        </div>
        <Badge variant={mfaEnabled ? "success" : "warning"}>
          {mfaEnabled ? "Enabled" : "Not Set Up"}
        </Badge>
      </div>

      {mfaEnabled && !showDisable && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">
            MFA is active on your account. {backupCodesCount} backup codes remaining.
          </p>
          <ActionButton variant="danger" size="sm" onClick={() => setShowDisable(true)}>
            Disable MFA
          </ActionButton>
        </div>
      )}

      {mfaEnabled && showDisable && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Enter your current TOTP code to disable MFA.
          </p>
          <div>
            <label
              htmlFor="disable-mfa-code"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              TOTP Code
            </label>
            <input
              id="disable-mfa-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              className={INPUT_CLASS}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              placeholder="000000"
            />
          </div>
          <div className="flex gap-2">
            <ActionButton
              variant="danger"
              size="sm"
              loading={disableLoading}
              onClick={handleDisable}
            >
              Confirm Disable
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowDisable(false);
                setDisableCode("");
              }}
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      )}

      {!mfaEnabled && !setupData && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Protect your admin account with time-based one-time passwords (TOTP).
          </p>
          <ActionButton
            variant="primary"
            size="sm"
            loading={setupLoading}
            onClick={handleStartSetup}
          >
            Setup MFA
          </ActionButton>
        </div>
      )}

      {!mfaEnabled && setupData && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Scan the QR code with your authenticator app (Google Authenticator, Authy, etc).
          </p>
          {setupData.qrCode && (
            <div className="flex justify-center rounded-lg border border-[var(--border-subtle)] bg-white p-3">
              <img src={setupData.qrCode} alt="MFA QR code" className="h-40 w-40" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Manual entry key
            </label>
            <code className="block rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 font-mono text-xs text-[var(--text-primary)] select-all break-all">
              {setupData.secret}
            </code>
          </div>
          <div>
            <label
              htmlFor="verify-mfa-code"
              className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
            >
              Verification Code
            </label>
            <input
              id="verify-mfa-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              className={INPUT_CLASS}
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="Enter 6-digit code"
            />
          </div>
          <div className="flex gap-2">
            <ActionButton
              variant="primary"
              size="sm"
              loading={verifyLoading}
              onClick={handleVerify}
            >
              Verify & Enable
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setSetupData(null);
                setVerifyCode("");
              }}
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      )}

      {/* Backup codes display after successful setup */}
      {backupCodes && backupCodes.length > 0 && (
        <div className="mt-3 rounded-lg border border-[var(--warning)] border-opacity-30 bg-[var(--warning-subtle)] p-3">
          <p className="text-xs font-medium text-[var(--warning)] mb-2">
            Save these backup codes securely. They will not be shown again.
          </p>
          <div className="grid grid-cols-2 gap-1">
            {backupCodes.map((code) => (
              <code
                key={code}
                className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-xs text-[var(--text-primary)]"
              >
                {code}
              </code>
            ))}
          </div>
          <ActionButton
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => setBackupCodes(null)}
          >
            I have saved my codes
          </ActionButton>
        </div>
      )}
    </div>
  );
}
