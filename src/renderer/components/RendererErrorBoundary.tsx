import { Component, type ErrorInfo, type ReactNode } from 'react';

type RendererErrorBoundaryProps = {
  children: ReactNode;
};

type RendererErrorBoundaryState = {
  errorMessage: string | null;
};

export default class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {
    errorMessage: null
  };

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return {
      errorMessage: error.message || 'The interface stopped unexpectedly.'
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    window.floatAI.reportRendererError({
      kind: 'react-error',
      message: error.message || 'Unknown React renderer error',
      stack: error.stack,
      componentStack: info.componentStack ?? undefined
    });
  }

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <main className="renderer-error-shell" role="alert">
        <section className="renderer-error-card">
          <p className="renderer-error-eyebrow">Float AI recovered an interface error</p>
          <h1>Reload the window to continue</h1>
          <p>{this.state.errorMessage}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Float AI
          </button>
        </section>
      </main>
    );
  }
}
