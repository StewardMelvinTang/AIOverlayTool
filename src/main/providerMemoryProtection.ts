export const providerProcessMemoryLimitKb = 1024 * 1024;
export const criticalTotalMemoryLimitKb = 3 * 1024 * 1024;
export const criticalProviderProcessFloorKb = 768 * 1024;

export type ProviderProcessMemorySample = {
  providerId: string;
  webContentsId: number;
  processId: number;
  privateBytesKb: number;
};

export type ProviderMemoryRecoveryDecision = {
  reason: 'provider-process-limit' | 'critical-total-memory';
  processId: number;
  privateBytesKb: number;
  providerIds: string[];
  webContentsIds: number[];
};

type ProviderProcessGroup = {
  processId: number;
  privateBytesKb: number;
  providerIds: Set<string>;
  webContentsIds: Set<number>;
};

export function chooseProviderMemoryRecovery(
  samples: ProviderProcessMemorySample[],
  totalPrivateBytesKb: number
): ProviderMemoryRecoveryDecision | null {
  const groupsByProcessId = new Map<number, ProviderProcessGroup>();

  for (const sample of samples) {
    if (
      !Number.isFinite(sample.processId) ||
      sample.processId <= 0 ||
      !Number.isFinite(sample.privateBytesKb) ||
      sample.privateBytesKb <= 0
    ) {
      continue;
    }

    const existing = groupsByProcessId.get(sample.processId);
    const group = existing ?? {
      processId: sample.processId,
      privateBytesKb: sample.privateBytesKb,
      providerIds: new Set<string>(),
      webContentsIds: new Set<number>()
    };

    // Multiple webviews can share one renderer process. The process memory
    // must only be counted once, so retain the largest observation.
    group.privateBytesKb = Math.max(group.privateBytesKb, sample.privateBytesKb);
    group.providerIds.add(sample.providerId);
    group.webContentsIds.add(sample.webContentsId);
    groupsByProcessId.set(sample.processId, group);
  }

  const largestProviderProcess = [...groupsByProcessId.values()].sort(
    (left, right) => right.privateBytesKb - left.privateBytesKb
  )[0];

  if (!largestProviderProcess) {
    return null;
  }

  const reason = largestProviderProcess.privateBytesKb >= providerProcessMemoryLimitKb
    ? 'provider-process-limit'
    : totalPrivateBytesKb >= criticalTotalMemoryLimitKb &&
        largestProviderProcess.privateBytesKb >= criticalProviderProcessFloorKb
      ? 'critical-total-memory'
      : null;

  if (!reason) {
    return null;
  }

  return {
    reason,
    processId: largestProviderProcess.processId,
    privateBytesKb: largestProviderProcess.privateBytesKb,
    providerIds: [...largestProviderProcess.providerIds].sort(),
    webContentsIds: [...largestProviderProcess.webContentsIds].sort((left, right) => left - right)
  };
}
