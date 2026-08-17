import PopupWindow from './components/PopupWindow';
import ProviderBrowserWindow from './components/ProviderBrowserWindow';
import QuickAskWindow from './components/QuickAskWindow';

export default function App() {
  const windowName = new URLSearchParams(window.location.search).get('window');

  if (windowName === 'quickAsk') {
    return <QuickAskWindow />;
  }

  if (windowName === 'browser') {
    return <ProviderBrowserWindow />;
  }

  return <PopupWindow />;
}
