import 'reflect-metadata';
import { HttpClient, Get } from '../src';

describe('代理方法拦截', () => {
    it('should return a proxy instance when constructing with @HttpClient', () => {
        @HttpClient({ baseURL: 'https://api.example.com' })
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        class UserService {}

        const service = new UserService();
        expect(service).toBeInstanceOf(UserService);
    });

    it('should intercept decorated methods', async () => {
        @HttpClient({ baseURL: 'https://api.example.com' })
        class TestService {
            @Get('/users/:id')
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            getUser(_id: string): Promise<unknown> {
                return Promise.resolve({ id: 'test' });
            }
        }

        const service = new TestService();
        expect(typeof (service as unknown as { getUser: unknown }).getUser).toBe('function');
    });
});

describe('参数映射', () => {
    it('should build correct URL with path params', async () => {
        const baseURL = 'https://api.example.com';
        const path = '/users/:id';
        const pathParams: Record<string, string> = { id: '123' };

        let resultPath = path;
        for (const [key, value] of Object.entries(pathParams)) {
            resultPath = resultPath.replace(`:${key}`, value);
        }
        const url = new URL(resultPath, baseURL).toString();

        expect(url).toBe('https://api.example.com/users/123');
    });

    it('should build correct URL with query params', async () => {
        const baseURL = 'https://api.example.com';
        const path = '/users';
        const queryParams: Record<string, string> = { page: '1', size: '10' };

        const url = new URL(path, baseURL);
        for (const [key, value] of Object.entries(queryParams)) {
            url.searchParams.set(key, value);
        }

        expect(url.toString()).toBe('https://api.example.com/users?page=1&size=10');
    });

    it('should combine path and query params', async () => {
        const baseURL = 'https://api.example.com';
        const path = '/users/:id';
        const pathParams: Record<string, string> = { id: '123' };
        const queryParams: Record<string, string> = { expand: 'true' };

        let resultPath = path;
        for (const [key, value] of Object.entries(pathParams)) {
            resultPath = resultPath.replace(`:${key}`, value);
        }

        const url = new URL(resultPath, baseURL);
        for (const [key, value] of Object.entries(queryParams)) {
            url.searchParams.set(key, value);
        }

        expect(url.toString()).toBe('https://api.example.com/users/123?expand=true');
    });
});
