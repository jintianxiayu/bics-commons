import 'reflect-metadata';
import axios from 'axios';
import { HttpClient, Get, Post, Put, Delete, Path, Query, Body, HttpError } from '../src';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

function mockResponse(status: number, data: unknown): void {
    mockedAxios.mockResolvedValue({ status, data, headers: {} } as never);
}

describe('集成测试：完整 HTTP 请求流程', () => {
    beforeEach(() => {
        mockedAxios.mockReset();
    });

    it('should throw HttpError on 404', async () => {
        mockResponse(404, { message: 'User not found' });

        @HttpClient({ baseURL: 'https://api.example.com' })
        class UserService {
            @Get('/users/:id')
            async getUser(@Path('id') _id: string): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const service = new UserService();

        await expect(service.getUser('missing')).rejects.toMatchObject<HttpError>({
            name: 'HttpError',
            status: 404,
            data: { message: 'User not found' },
            message: 'HTTP 404: https://api.example.com/users/missing',
        });
        expect(mockedAxios).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'GET', url: 'https://api.example.com/users/missing' })
        );
    });

    it('should execute decorated methods with their HTTP methods and mapped arguments', async () => {
        mockResponse(200, { success: true });

        @HttpClient({ baseURL: 'https://api.example.com' })
        class ArticleService {
            @Get('/articles/:slug')
            async getArticle(@Path('slug') _slug: string, @Query('lang') _lang: string): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Post('/articles')
            async createArticle(@Body() _body: unknown): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Put('/articles/:id')
            async updateArticle(@Path('id') _id: string, @Body() _body: unknown): Promise<unknown> {
                throw new Error('Original method should not execute');
            }

            @Delete('/articles/:id')
            async deleteArticle(@Path('id') _id: string): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const service = new ArticleService();
        const createdArticle = { title: 'New article' };
        const updatedArticle = { title: 'Updated article' };

        await expect(service.getArticle('welcome', 'zh-CN')).resolves.toEqual({ success: true });
        await expect(service.createArticle(createdArticle)).resolves.toEqual({ success: true });
        await expect(service.updateArticle('42', updatedArticle)).resolves.toEqual({ success: true });
        await expect(service.deleteArticle('42')).resolves.toEqual({ success: true });

        expect(mockedAxios).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ method: 'GET', url: 'https://api.example.com/articles/welcome?lang=zh-CN' })
        );
        expect(mockedAxios).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ method: 'POST', url: 'https://api.example.com/articles', data: createdArticle })
        );
        expect(mockedAxios).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ method: 'PUT', url: 'https://api.example.com/articles/42', data: updatedArticle })
        );
        expect(mockedAxios).toHaveBeenNthCalledWith(
            4,
            expect.objectContaining({ method: 'DELETE', url: 'https://api.example.com/articles/42' })
        );
    });

    it('should map multiple @Path parameters into one request URL', async () => {
        mockResponse(200, { repository: true });

        @HttpClient({ baseURL: 'https://api.example.com' })
        class NestedService {
            @Get('/orgs/:orgId/repos/:repoId')
            async getNested(@Path('orgId') _orgId: string, @Path('repoId') _repoId: string): Promise<unknown> {
                throw new Error('Original method should not execute');
            }
        }

        const result = await new NestedService().getNested('openai', 'codex');

        expect(result).toEqual({ repository: true });
        expect(mockedAxios).toHaveBeenCalledWith(
            expect.objectContaining({ method: 'GET', url: 'https://api.example.com/orgs/openai/repos/codex' })
        );
    });
});
