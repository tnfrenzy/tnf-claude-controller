import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../../i18n";

/**
 * Keeps a crashing popup from blanking the whole app: shows a short message and a close button instead.
 * Remount it (change `key`) when the popup changes, so one failure does not stick to the next popup.
 */
class Boundary extends Component<{ children: ReactNode; onClose: () => void; title: string; closeLabel: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[popup] render error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="ss-overlay" role="alert">
        <div className="ss-modal">
          <div className="ss-body">
            <p className="error">{this.props.title}</p>
            <p className="muted">{this.state.error.message}</p>
            <button type="button" className="primary" onClick={this.props.onClose}>
              {this.props.closeLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export function PopupBoundary(props: { children: ReactNode; onClose: () => void }) {
  const { t } = useT();
  return (
    <Boundary onClose={props.onClose} title={t.popup_error_title} closeLabel={t.popup_error_close}>
      {props.children}
    </Boundary>
  );
}
