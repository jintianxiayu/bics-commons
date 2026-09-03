import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
    globalIgnores(['**/dist/**']),
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.[t|j]s', '**/*.[m|c]js'],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off', // 允许显式使用 any 类型
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ], // 允许参数名为 _ 时未被使用
            'max-depth': ['error', 4], // 代码块嵌套深度最多为 4 层
            'max-params': ['error', 4], // 函数参数最多为 4 个
            'max-lines-per-function': ['error', { max: 300, skipBlankLines: true, skipComments: true }], // 单个函数最多为 300 行，忽略空行和注释
            'no-duplicate-imports': 'error', // 禁止从同一模块重复导入
            'no-empty': ['error', { allowEmptyCatch: false }], // 禁止空代码块，包括空的 catch 块
            'no-new-wrappers': 'error', // 禁止使用 new 创建原始类型包装对象
            curly: ['error', 'all'], // 所有控制语句必须使用花括号
        },
    }
);
