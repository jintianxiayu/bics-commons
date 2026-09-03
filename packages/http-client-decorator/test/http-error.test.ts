import { HttpError } from '../src';

describe('HttpError', () => {
    it('should preserve status, response data, and message', () => {
        const error = new HttpError(500, { message: 'Server error' }, 'HTTP 500');

        expect(error).toMatchObject({
            name: 'HttpError',
            status: 500,
            data: { message: 'Server error' },
            message: 'HTTP 500',
        });
    });
});
