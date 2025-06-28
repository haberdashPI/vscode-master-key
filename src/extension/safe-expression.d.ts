declare module 'safe-expression' {
    export default SafeExpression;

    export type EvalFun = (scope: { [k: string]: unknown }) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
    class SafeExpression {
        constructor();
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
    interface SafeExpression {
        (exp: string): EvalFun;
    }
}
