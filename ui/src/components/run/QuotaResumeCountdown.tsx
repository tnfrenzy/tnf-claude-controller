import { useEffect, useState } from "react";
import { formatCountdown, startCountdownTimer } from "../../quotaCountdown.js";

export interface QuotaResumeCountdownProps {
  resumeAt: number;
  label: string;
  cancelLabel: string;
  onCancel: () => void;
  busy?: boolean;
  showCancel?: boolean;
}

export function QuotaResumeCountdownView(props: QuotaResumeCountdownProps & { msLeft: number }) {
  const { resumeAt, label, cancelLabel, onCancel, busy, msLeft, showCancel = true } = props;
  return (
    <div className="quota-resume-countdown">
      <span>{label}</span> <strong>{formatCountdown(msLeft)}</strong>{" "}
      <span>{new Date(resumeAt).toLocaleTimeString()}</span>{" "}
      {showCancel && (
        <button type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
      )}
    </div>
  );
}

export function QuotaResumeCountdown(props: QuotaResumeCountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => startCountdownTimer(() => setNow(Date.now())), []);
  return <QuotaResumeCountdownView {...props} msLeft={props.resumeAt - now} />;
}
