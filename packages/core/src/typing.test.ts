import { describe, it, expect } from 'vitest';
import { inferType } from '@tokenflow/shared';
import { validateValue } from './validator.js';

describe('inferType — numeric strings are dimensions', () => {
  it('infers a bare numeric string as dimension (not number)', () => {
    expect(inferType('0')).toBe('dimension');
    expect(inferType('16')).toBe('dimension');
    expect(inferType('1.5')).toBe('dimension');
  });
  it('keeps JSON numbers as number', () => {
    expect(inferType(0)).toBe('number');
    expect(inferType(1.5)).toBe('number');
  });
  it('still infers units and durations', () => {
    expect(inferType('600px')).toBe('dimension');
    expect(inferType('10ch')).toBe('dimension');
    expect(inferType('200ms')).toBe('duration');
    expect(inferType('#fff')).toBe('color');
  });
});

describe('validateValue — dimension/number leniency', () => {
  it('accepts a unitless "0" as a dimension', () => {
    expect(validateValue('0', 'dimension')).toBeNull();
  });
  it('accepts a value with any CSS unit', () => {
    expect(validateValue('0px', 'dimension')).toBeNull();
    expect(validateValue('2rem', 'dimension')).toBeNull();
    expect(validateValue('10ch', 'dimension')).toBeNull();
  });
  it('accepts numeric strings for the number type', () => {
    expect(validateValue('0', 'number')).toBeNull();
    expect(validateValue(1.5, 'number')).toBeNull();
    expect(validateValue('abc', 'number')).not.toBeNull();
  });
});
