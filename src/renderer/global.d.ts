import type { FloatAIBridge } from '../shared/bridge';

declare global {
  interface Window {
    floatAI: FloatAIBridge;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean;
          useragent?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
