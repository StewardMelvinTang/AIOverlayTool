import { PackageCheck } from 'lucide-react';
import { getAddonManifest } from '../../../shared/addonsRegistry';
import ScratchPadPanel from './ScratchPadPanel';
import SpeedTestPanel from './SpeedTestPanel';

export default function ActiveAddonPanel({
  addonId,
  expanded,
  onToggleExpanded
}: {
  addonId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const addon = getAddonManifest(addonId);

  if (addonId === 'scratchpad') {
    return <ScratchPadPanel expanded={expanded} onToggleExpanded={onToggleExpanded} />;
  }

  if (addonId === 'speedtest') {
    return <SpeedTestPanel />;
  }

  return (
    <div className="addon-empty-state">
      <PackageCheck size={30} />
      <strong>{addon?.title ?? 'Add-on'} unavailable</strong>
      <span>This add-on does not have a bundled panel yet.</span>
    </div>
  );
}
