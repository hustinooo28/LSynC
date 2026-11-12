import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
}

/** Confirmation for destructive actions. */
export default function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Delete", loading }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      icon={<AlertTriangle className="h-5 w-5 text-danger" />}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>{loading ? "Working…" : confirmLabel}</button>
        </>
      }
    />
  );
}
