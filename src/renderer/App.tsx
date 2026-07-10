import PopupWindow from './components/PopupWindow';
import QuickAskWindow from './components/QuickAskWindow';

export default function App() {
  const windowName = new URLSearchParams(window.location.search).get('window');

  if (windowName === 'quickAsk') {
    return <QuickAskWindow />;
  }

  return <PopupWindow />;
}
