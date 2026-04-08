/**
 * @file AccountEditForm.tsx
 * @description Inline edit form for account properties (name, active, trial, auto-renewal).
 * @layer presentation
 */

import { ActionButton } from "@/components/ui/ActionButton";

interface EditFormData {
  name: string;
  email: string;
  phone: string;
  isActive: boolean;
  isOnTrial: boolean;
  trialEndDate: string;
  autoRenewal: boolean;
}

interface AccountEditFormProps {
  accountId: string;
  editForm: EditFormData;
  onFormChange: (updater: (prev: EditFormData) => EditFormData) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function AccountEditForm({
  accountId,
  editForm,
  onFormChange,
  onSave,
  onCancel,
}: AccountEditFormProps) {
  const inputClass =
    "px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]";

  return (
    <div className="flex items-end gap-4">
      <div>
        <label
          htmlFor={`edit-name-${accountId}`}
          className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
        >
          Name
        </label>
        <input
          id={`edit-name-${accountId}`}
          type="text"
          value={editForm.name}
          onChange={(e) => onFormChange((prev) => ({ ...prev, name: e.target.value }))}
          className={inputClass}
        />
      </div>
      <div>
        <label
          htmlFor={`edit-email-${accountId}`}
          className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
        >
          Email
        </label>
        <input
          id={`edit-email-${accountId}`}
          type="email"
          value={editForm.email}
          onChange={(e) => onFormChange((prev) => ({ ...prev, email: e.target.value }))}
          className={inputClass}
        />
      </div>
      <div>
        <label
          htmlFor={`edit-phone-${accountId}`}
          className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
        >
          Phone
        </label>
        <input
          id={`edit-phone-${accountId}`}
          type="tel"
          value={editForm.phone}
          onChange={(e) => onFormChange((prev) => ({ ...prev, phone: e.target.value }))}
          placeholder="Optional"
          className={inputClass}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id={`edit-active-${accountId}`}
          type="checkbox"
          checked={editForm.isActive}
          onChange={(e) => onFormChange((prev) => ({ ...prev, isActive: e.target.checked }))}
          className="rounded border-[var(--border-default)]"
        />
        <label
          htmlFor={`edit-active-${accountId}`}
          className="text-sm text-[var(--text-secondary)]"
        >
          Active
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={`edit-trial-${accountId}`}
          type="checkbox"
          checked={editForm.isOnTrial}
          onChange={(e) => onFormChange((prev) => ({ ...prev, isOnTrial: e.target.checked }))}
          className="rounded border-[var(--border-default)]"
        />
        <label htmlFor={`edit-trial-${accountId}`} className="text-sm text-[var(--text-secondary)]">
          On Trial
        </label>
      </div>
      {editForm.isOnTrial && (
        <div>
          <label
            htmlFor={`edit-trial-end-${accountId}`}
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
          >
            Trial End Date
          </label>
          <input
            id={`edit-trial-end-${accountId}`}
            type="date"
            value={editForm.trialEndDate}
            onChange={(e) => onFormChange((prev) => ({ ...prev, trialEndDate: e.target.value }))}
            className="px-2 py-1 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          id={`edit-autorenewal-${accountId}`}
          type="checkbox"
          checked={editForm.autoRenewal}
          onChange={(e) => onFormChange((prev) => ({ ...prev, autoRenewal: e.target.checked }))}
          className="rounded border-[var(--border-default)]"
        />
        <label
          htmlFor={`edit-autorenewal-${accountId}`}
          className="text-sm text-[var(--text-secondary)]"
        >
          Auto-Renewal
        </label>
      </div>
      <ActionButton variant="primary" size="sm" onClick={onSave}>
        Save
      </ActionButton>
      <ActionButton variant="secondary" size="sm" onClick={onCancel}>
        Cancel
      </ActionButton>
    </div>
  );
}
