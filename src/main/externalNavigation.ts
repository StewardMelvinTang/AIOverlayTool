export type ExternalNavigationKind = 'web' | 'external-app' | 'blocked';

export type ExternalNavigationTarget = {
  kind: ExternalNavigationKind;
  protocol: string | null;
};

const webProtocols = new Set(['http:', 'https:']);

// Keep this list explicit. Provider pages are untrusted web content, so handing
// arbitrary schemes to the operating system would give them too much power.
// These protocols are limited to common communication and app-deep-link flows.
const externalApplicationProtocols = new Set([
  'mailto:',
  'tel:',
  'sms:',
  'callto:',
  'zoommtg:',
  'zoomus:',
  'zoomphonecall:',
  'zoomphonesms:',
  'msteams:',
  'ms-teams:',
  'skype:',
  'sip:',
  'sips:',
  'webex:',
  'wbx:',
  'slack:',
  'discord:',
  'notion:',
  'spotify:',
  'tg:',
  'facetime:',
  'facetime-audio:'
]);

export function classifyExternalNavigationUrl(value: string): ExternalNavigationTarget {
  if (!value || value === 'about:blank') {
    return { kind: 'blocked', protocol: null };
  }

  try {
    const protocol = new URL(value).protocol.toLowerCase();

    if (webProtocols.has(protocol)) {
      return { kind: 'web', protocol };
    }

    if (externalApplicationProtocols.has(protocol)) {
      return { kind: 'external-app', protocol };
    }

    return { kind: 'blocked', protocol };
  } catch {
    return { kind: 'blocked', protocol: null };
  }
}
