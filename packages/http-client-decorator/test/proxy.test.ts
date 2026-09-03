import 'reflect-metadata';
import axios from 'axios';
import { HttpClient, Get, Post, Path, Query, Body, Header } from '../src';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

describe('代理方法拦截', () => {
    beforeEach(() => {
        mockedAxios.mockReset();
        mockedAxios.mockResolvedValue({ status: 200, data: { id: 'remote' }, headers: {} } as never);
    });

    it('should intercept decorated methods while preserving local methods', async () => {
        let originalCallCount = 0;

        @HttpClient({ baseURL: 'https://api.example.com' })
        class UserService {
            @Get('/users/:id')
            async getUser(@Path('id') _id: string): Promise<unknown> {
                originalCallCount++;
                return { id: 'local' };
            }

            getSource(): string {
                return 'local';
            }
        }

        const service = new UserService();

        await expect(service.getUser('123')).resolves.toEqual({ id: 'remote' });
        expect(originalCallCount).toBe(0);
        expect(service.getSource()).toBe('local');
    });

    it('should map path, query, header, and body arguments into the actual request', async () => {
        @HttpClient({ baseURL: 'https://api.example.com/', headers: { 'x-client': 'test' } })
        class UserService {
            @Post('/users/:id')
            async updateUser(
                @Path('id') _id: string,
                @Query('expand') _expand: string,
                @Header('authorization') _authorization: string,
                @Body() _body: unknown
            ): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const body = { name: 'Alice' };
        const result = await new UserService().updateUser('123', 'true', 'Bearer token', body);

        expect(result).toEqual({ id: 'remote' });
        expect(mockedAxios).toHaveBeenCalledWith({
            method: 'POST',
            url: 'https://api.example.com/users/123?expand=true',
            headers: { 'x-client': 'test', authorization: 'Bearer token' },
            data: body,
            timeout: undefined,
            validateStatus: expect.any(Function),
        });
    });
});
