/**
 * SensitiveMasker 单元测试
 */

import { SensitiveMasker } from '../../../src/core/SensitiveMasker';

describe('SensitiveMasker', () => {
  beforeEach(() => {
    SensitiveMasker.reset();
  });

  describe('compileTemplate & renderMask', () => {
    it('should render full mask template', () => {
      SensitiveMasker.init({ fields: [{ field: 'password', mask: '********' }] });
      const result = SensitiveMasker.mask({ password: 'secret123' });
      expect(result).toEqual({ password: '********' });
    });

    it('should render {last4} placeholder', () => {
      SensitiveMasker.init({ fields: [{ field: 'phone', mask: '*** *** {last4}' }] });
      const result = SensitiveMasker.mask({ phone: '13812345678' });
      expect(result).toEqual({ phone: '*** *** 5678' });
    });

    it('should render {firstN} placeholder', () => {
      SensitiveMasker.init({ fields: [{ field: 'id', mask: '{first3}****' }] });
      const result = SensitiveMasker.mask({ id: '13812345678' });
      expect(result).toEqual({ id: '138****' });
    });

    it('should render {domain} placeholder', () => {
      SensitiveMasker.init({ fields: [{ field: 'email', mask: '{first2}***@{domain}' }] });
      const result = SensitiveMasker.mask({ email: 'john@example.com' });
      expect(result).toEqual({ email: 'jo***@example.com' });
    });
  });

  describe('applyPlaceholder', () => {
    it('should handle {lastN} when value length <= N', () => {
      SensitiveMasker.init({ fields: [{ field: 'code', mask: '{last4}' }] });
      const result = SensitiveMasker.mask({ code: '123' });
      expect(result).toEqual({ code: '*123' });
    });

    it('should handle email without @ as domain', () => {
      SensitiveMasker.init({ fields: [{ field: 'email', mask: '{domain}' }] });
      const result = SensitiveMasker.mask({ email: 'justusername' });
      expect(result).toEqual({ email: '********' });
    });
  });

  describe('maskObject - top level', () => {
    it('should mask top-level sensitive field', () => {
      SensitiveMasker.init({ fields: [{ field: 'password', mask: '********' }] });
      const result = SensitiveMasker.mask({ password: 'secret123' });
      expect(result).toEqual({ password: '********' });
    });

    it('should not mask non-sensitive fields', () => {
      SensitiveMasker.init({ fields: [{ field: 'password', mask: '********' }] });
      const result = SensitiveMasker.mask({ username: 'john' });
      expect(result).toEqual({ username: 'john' });
    });
  });

  describe('maskObject - nested', () => {
    it('should mask nested sensitive field', () => {
      SensitiveMasker.init({ fields: [{ field: 'password', mask: '********' }] });
      const result = SensitiveMasker.mask({ user: { password: 'secret123' } });
      expect(result).toEqual({ user: { password: '********' } });
    });

    it('should handle deep nesting within limit', () => {
      SensitiveMasker.init({ fields: [{ field: 'secret', mask: '****' }] });
      const deep = { l1: { l2: { l3: { l4: { l5: { secret: 'data' } } } } } };
      const result = SensitiveMasker.mask(deep) as { l1: { l2: { l3: { l4: { l5: { secret: string } } } } } };
      expect(result.l1.l2.l3.l4.l5.secret).toBe('****');
    });

    it('should return MAX_DEPTH_EXCEEDED for too deep nesting', () => {
      SensitiveMasker.init({ fields: [{ field: 'secret', mask: '****' }] });
      const deep = {
        l1: { l2: { l3: { l4: { l5: { l6: { secret: 'data' } } } } } }
      };
      const result = SensitiveMasker.mask(deep) as { l1: { l2: { l3: { l4: { l5: { secret: string } } } } } };
      expect(result.l1.l2.l3.l4.l5.l6).toBe('[MAX_DEPTH_EXCEEDED]');
    });
  });

  describe('maskObject - array', () => {
    it('should mask sensitive fields in array', () => {
      SensitiveMasker.init({ fields: [{ field: 'password', mask: '********' }] });
      const result = SensitiveMasker.mask({
        users: [
          { name: 'A', password: 'pass1' },
          { name: 'B', password: 'pass2' },
        ],
      });
      expect(result).toEqual({
        users: [
          { name: 'A', password: '********' },
          { name: 'B', password: '********' },
        ],
      });
    });
  });

  describe('switch control', () => {
    it('should mask when enabled (default)', () => {
      SensitiveMasker.init({});
      const result = SensitiveMasker.mask({ password: 'secret' });
      expect(result).toEqual({ password: '********' });
    });

    it('should not mask when disabled', () => {
      SensitiveMasker.init({ enabled: false });
      const result = SensitiveMasker.mask({ password: 'secret' });
      expect(result).toEqual({ password: 'secret' });
    });
  });

  describe('edge cases', () => {
    it('should handle null value', () => {
      SensitiveMasker.init({ fields: [{ field: 'data', mask: '****' }] });
      const result = SensitiveMasker.mask({ data: null });
      expect(result).toEqual({ data: '****' });
    });

    it('should handle undefined value', () => {
      SensitiveMasker.init({ fields: [{ field: 'data', mask: '****' }] });
      const result = SensitiveMasker.mask({ data: undefined });
      expect(result).toEqual({ data: '****' });
    });

    it('should handle number value', () => {
      SensitiveMasker.init({ fields: [{ field: 'data', mask: '****' }] });
      const result = SensitiveMasker.mask({ data: 12345 });
      expect(result).toEqual({ data: '****' });
    });
  });

  describe('empty string', () => {
    it('should handle empty string', () => {
      SensitiveMasker.init({ fields: [{ field: 'name', mask: '{last4}' }] });
      const result = SensitiveMasker.mask({ name: '' });
      expect(result).toEqual({ name: '' });
    });
  });

  describe('config override', () => {
    it('should use custom mask from config', () => {
      SensitiveMasker.init({ fields: [{ field: 'password', mask: '******' }] });
      const result = SensitiveMasker.mask({ password: 'secret' });
      expect(result).toEqual({ password: '******' });
    });

    it('should add custom sensitive field', () => {
      SensitiveMasker.init({ fields: [{ field: 'customSecret', mask: '********' }] });
      const result = SensitiveMasker.mask({ customSecret: 'mysecret' });
      expect(result).toEqual({ customSecret: '********' });
    });
  });
});