import assert from 'node:assert/strict';
import { normalizeMetadata } from '../../src/core/MetadataNormalizer';
import { SensitiveMasker } from '../../src/core/SensitiveMasker';

describe('metadata normalization', () => {
    test('maps arguments according to the public contract', () => {
        assert.deepEqual(normalizeMetadata([]), {});
        assert.deepEqual(normalizeMetadata([{ answer: 42 }]).meta, { answer: 42 });
        assert.deepEqual(normalizeMetadata([1]).meta, { args: [1] });
        assert.deepEqual(normalizeMetadata([{ answer: 42 }, 'next']).meta, {
            args: [{ answer: 42 }, 'next'],
        });
    });

    test('normalizes nested errors including custom properties', () => {
        const error = new Error('failure') as Error & { code: string };
        error.code = 'E_TEST';
        const normalized = normalizeMetadata([{ error }]).meta as {
            error: { name: string; message: string; stack: string; code: string };
        };

        assert.equal(normalized.error.name, 'Error');
        assert.equal(normalized.error.message, 'failure');
        // 正则说明：固定文本 failure 验证 Error stack 保留原始消息，不依赖 Node.js 版本相关的完整栈格式。
        assert.match(normalized.error.stack, /failure/);
        assert.equal(normalized.error.code, 'E_TEST');
    });

    test('contains circular and hostile metadata without throwing', () => {
        /** 循环元数据映射中 K 为业务字段名，V 为未知字段值；self 会指回映射自身以构造循环。 */
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const circularResult = normalizeMetadata([circular]);
        assert.equal((circularResult.meta as Record<string, unknown>).self, '[Circular]');
        assert.equal(circularResult.issue, 'CircularReference');

        const hostile = {};
        Object.defineProperty(hostile, 'value', {
            enumerable: true,
            get() {
                throw new TypeError('do not expose this value');
            },
        });
        const hostileResult = normalizeMetadata([hostile]);
        assert.deepEqual(hostileResult.meta, {
            serializationError: '[Unserializable metadata]',
        });
        assert.equal(hostileResult.issue, 'TypeError');
    });
});

describe('SensitiveMasker', () => {
    test('masks default fields recursively without mutating the caller object', () => {
        const input = {
            Password: 'secret',
            nested: [{ authorization: 'Bearer value', phone: '13800138000' }],
            email: 'member@example.com',
        };
        const before = structuredClone(input);
        const masker = new SensitiveMasker({ enabled: true, fields: {} });
        const output = masker.mask(input) as typeof input;

        assert.equal(output.Password, '********');
        assert.equal(output.nested[0]!.authorization, '********');
        // 正则说明：8000$ 将末四位固定在字符串结尾，验证默认号码策略保留原值最后四位。
        assert.match(output.nested[0]!.phone, /8000$/);
        assert.equal(output.email, 'me***@example.com');
        expect(input).toEqual(before);
        assert.notEqual(output, input);
        assert.notEqual(output.nested, input.nested);
    });

    test('applies custom templates and safely masks short values', () => {
        const masker = new SensitiveMasker({
            enabled: true,
            fields: {
                tenantSecret: '********',
                memberEmail: '{first2}***@{domain}',
                account: '***{last4}',
            },
        });
        /** 自定义脱敏结果映射中 K 为业务字段名，V 为应用对应模板后的安全字段值。 */
        const output = masker.mask({
            tenantSecret: 'tenant-value',
            memberEmail: 'member@example.com',
            account: '123456789',
            phone: '123',
        }) as Record<string, unknown>;

        assert.equal(output.tenantSecret, '********');
        assert.equal(output.memberEmail, 'me***@example.com');
        assert.equal(output.account, '***6789');
        assert.equal(output.phone, '********');
    });

    test('still clones when masking is disabled', () => {
        const input = { password: 'visible', nested: { value: 1 } };
        const output = new SensitiveMasker({ enabled: false, fields: {} }).mask(input) as typeof input;
        assert.deepEqual(output, input);
        assert.notEqual(output, input);
        assert.notEqual(output.nested, input.nested);
    });
});
