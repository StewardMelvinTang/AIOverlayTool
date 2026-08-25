const assert = require('node:assert/strict');
const {
  chooseProviderMemoryRecovery,
  criticalProviderProcessFloorKb,
  criticalTotalMemoryLimitKb,
  providerProcessMemoryLimitKb
} = require('../dist-electron/main/providerMemoryProtection');

const mb = 1024;

assert.equal(
  chooseProviderMemoryRecovery([
    { providerId: 'music', webContentsId: 10, processId: 100, privateBytesKb: 554 * mb },
    { providerId: 'chat', webContentsId: 11, processId: 101, privateBytesKb: 205 * mb }
  ], 1654 * mb),
  null,
  'A stable media-provider baseline must not be force-reset.'
);

assert.deepEqual(
  chooseProviderMemoryRecovery([
    { providerId: 'sound-cloud', webContentsId: 12, processId: 102, privateBytesKb: providerProcessMemoryLimitKb },
    { providerId: 'chat', webContentsId: 13, processId: 103, privateBytesKb: 240 * mb }
  ], 1900 * mb),
  {
    reason: 'provider-process-limit',
    processId: 102,
    privateBytesKb: providerProcessMemoryLimitKb,
    providerIds: ['sound-cloud'],
    webContentsIds: [12]
  },
  'A provider renderer at the hard limit must be selected for recovery.'
);

assert.deepEqual(
  chooseProviderMemoryRecovery([
    { providerId: 'music', webContentsId: 20, processId: 200, privateBytesKb: criticalProviderProcessFloorKb },
    { providerId: 'music-popup', webContentsId: 21, processId: 200, privateBytesKb: criticalProviderProcessFloorKb },
    { providerId: 'chat', webContentsId: 22, processId: 201, privateBytesKb: 400 * mb }
  ], criticalTotalMemoryLimitKb),
  {
    reason: 'critical-total-memory',
    processId: 200,
    privateBytesKb: criticalProviderProcessFloorKb,
    providerIds: ['music', 'music-popup'],
    webContentsIds: [20, 21]
  },
  'Critical total memory must recover the largest provider process without double-counting shared renderers.'
);

assert.equal(
  chooseProviderMemoryRecovery([
    { providerId: 'invalid', webContentsId: 30, processId: 0, privateBytesKb: 8 * 1024 * mb }
  ], 8 * 1024 * mb),
  null,
  'Invalid or not-yet-attached process identifiers must be ignored.'
);

console.log('provider-memory-protection: PASS (stable baseline, hard limit, critical total, and shared renderer)');
