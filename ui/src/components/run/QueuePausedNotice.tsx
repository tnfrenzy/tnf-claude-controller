import { useT } from "../../i18n";
import { QuotaResumeCountdown, QuotaResumeCountdownView } from "./QuotaResumeCountdown";

export interface QueuePausedNoticeProps {
  pausedUntil: number;
  pauseReason?: string | null | undefined;
  pauseRunId?: string | null | undefined;
  msLeft?: number | undefined;
  busy?: boolean | undefined;
  onCancel: () => void;
}

export function QueuePausedNotice(props: QueuePausedNoticeProps) {
  const { t } = useT();
  const { pausedUntil, pauseReason, pauseRunId, msLeft, busy, onCancel } = props;
  const canCancel = !!pauseRunId;
  const cd = { resumeAt: pausedUntil, label: t.qr_title, cancelLabel: t.qr_cancel, onCancel, busy: busy ?? false, showCancel: canCancel };
  return (
    <div className="fine" style={{ marginBottom: 8 }}>
      <div>{t.qr_queue_paused.replace("{time}", new Date(pausedUntil).toLocaleTimeString())}</div>
      {pauseReason && <div className="muted">{pauseReason}</div>}
      {typeof msLeft === "number" ? <QuotaResumeCountdownView {...cd} msLeft={msLeft} /> : <QuotaResumeCountdown {...cd} />}
      {canCancel && <div className="muted">{t.qr_cancel_queue_hint}</div>}
    </div>
  );
}
