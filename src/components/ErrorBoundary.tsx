import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="mx-auto max-w-lg p-8 text-center">
          <h2 className="text-lg font-bold">Something went wrong</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{this.state.error.message}</p>
          <button type="button" className="mt-4 rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold dark:bg-slate-800" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
