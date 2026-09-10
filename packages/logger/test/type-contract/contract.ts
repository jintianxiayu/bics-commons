import { type LoggerConfig, type SensitiveFieldConfig } from '@jintianxiayu/logger';

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;

/** 公共字段策略的值必须精确支持模板字符串与字面量 false。 */
export type SensitiveFieldValueMatch = Assert<Equal<SensitiveFieldConfig[string], string | false>>;

const stringTemplateFields: SensitiveFieldConfig = {
    password: '********',
    account: '***{last4}',
};
const fieldOptOut: SensitiveFieldConfig = {
    password: false,
};
const loggerConfig: LoggerConfig = {
    masking: {
        fields: {
            password: false,
            token: '********',
        },
    },
};

const invalidTrue: SensitiveFieldConfig = {
    // @ts-expect-error 字段策略不接受 true，只有 false 表示显式退出。
    password: true,
};
const invalidNull: SensitiveFieldConfig = {
    // @ts-expect-error null 不表示继承或退出策略。
    password: null,
};
const invalidNumber: SensitiveFieldConfig = {
    // @ts-expect-error 数字不是受支持的脱敏模板或退出标记。
    password: 0,
};

void stringTemplateFields;
void fieldOptOut;
void loggerConfig;
void invalidTrue;
void invalidNull;
void invalidNumber;
