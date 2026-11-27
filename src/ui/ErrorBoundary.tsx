import { Component, type ErrorInfo, type ReactNode } from 'react';
import { appendErrorLog } from '../state/errlog';

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  errorMessage: string | null;
}

/** React 錯誤邊界：攔截子樹例外，寫入錯誤紀錄並顯示深色復原畫面 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const msg = error instanceof Error ? error.message : String(error ?? '未知錯誤');
    return { errorMessage: msg.slice(0, 200) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const msg = error?.message || String(error ?? '未知錯誤');
    const stack = error?.stack || info?.componentStack || '';
    appendErrorLog({
      source: 'ErrorBoundary',
      message: this.props.label ? `[${this.props.label}] ${msg}` : msg,
      stack,
    });
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.errorMessage !== null) {
      return (
        <div className="error-boundary-screen" role="alert">
          <div className="error-boundary-card">
            <h1 className="error-boundary-title">發生錯誤</h1>
            <p className="error-boundary-msg">{this.state.errorMessage}</p>
            <button
              type="button"
              className="error-boundary-reload-btn"
              onClick={this.handleReload}
            >
              重新載入
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
