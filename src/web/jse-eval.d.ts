declare module 'jse-eval' {
    function compile(str: string): (data: object) => any
    function evaluate(str: string): any
    function parse(str: string): any
    function addBinaryOp(str: string, prec: number, fn?: (a: any, b: any) => any): void;
    function registerPlugin(module: any): void;
    const jsep: any;
}
