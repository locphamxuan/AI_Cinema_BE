import {
  DEFAULT_MAX_CONCURRENT_STREAMS,
  DEFAULT_MAX_REGISTERED_DEVICES,
  deviceLimitsOf,
  maxConcurrentStreamsOf,
  maxRegisteredDevicesOf,
} from './device-eligibility.port';

describe('maxConcurrentStreamsOf (hardening #13, BR-34)', () => {
  it.each([[1], [2], [10]])('accepts the positive integer %i', (value) => {
    expect(maxConcurrentStreamsOf({ maxDevices: value })).toBe(value);
  });

  it('reads maxConcurrentStreams first and falls back to the legacy maxDevices key', () => {
    expect(maxConcurrentStreamsOf({ maxConcurrentStreams: 3, maxDevices: 1 })).toBe(3);
    expect(maxConcurrentStreamsOf({ maxRegisteredDevices: 5, maxDevices: 2 })).toBe(2);
  });

  it('reads the key out of free-form feature JSON and ignores its neighbours', () => {
    expect(maxConcurrentStreamsOf({ downloads: true, maxDevices: 4, note: null, nested: { maxDevices: 99 } })).toBe(4);
  });

  const unusable: Array<[string, unknown]> = [
    ['a missing row', null],
    ['an undefined row', undefined],
    ['a bare number', 3],
    ['a stringified JSON row', '{"maxDevices":3}'],
    ['a boolean row', true],
    ['an empty object', {}],
    ['a nested-only key', { limits: { maxDevices: 3 } }],
    ['a string value', { maxDevices: '3' }],
    ['a boolean value', { maxDevices: true }],
    ['a null value', { maxDevices: null }],
    ['a fractional value', { maxDevices: 2.5 }],
    ['zero', { maxDevices: 0 }],
    ['a negative value', { maxDevices: -2 }],
    ['NaN', { maxDevices: Number.NaN }],
    ['Infinity', { maxDevices: Number.POSITIVE_INFINITY }],
    ['an array value', { maxDevices: [2] }],
    ['an object value', { maxDevices: { value: 2 } }],
  ];

  it.each(unusable)('answers null for %s so the caller can fall back', (_label, features) => {
    expect(maxConcurrentStreamsOf(features)).toBeNull();
  });
});

describe('maxRegisteredDevicesOf and deviceLimitsOf (BR-34)', () => {
  it('reads maxRegisteredDevices and never the stream keys', () => {
    expect(maxRegisteredDevicesOf({ maxRegisteredDevices: 4, maxConcurrentStreams: 2 })).toBe(4);
    expect(maxRegisteredDevicesOf({ maxDevices: 3 })).toBeNull();
    expect(maxRegisteredDevicesOf({ maxRegisteredDevices: 0 })).toBeNull();
    expect(maxRegisteredDevicesOf(null)).toBeNull();
  });

  it('fills the defaults in where the plan sets no usable limit', () => {
    expect(deviceLimitsOf({ code: 'MONTHLY', features: { maxRegisteredDevices: 4, maxConcurrentStreams: 3 } })).toEqual(
      {
        maxRegisteredDevices: 4,
        maxConcurrentStreams: 3,
      },
    );
    expect(deviceLimitsOf(null)).toEqual({
      maxRegisteredDevices: DEFAULT_MAX_REGISTERED_DEVICES,
      maxConcurrentStreams: DEFAULT_MAX_CONCURRENT_STREAMS,
    });
  });
});
