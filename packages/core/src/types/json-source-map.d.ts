declare module 'json-source-map' {
  interface Location {
    line: number;
    column: number;
    pos: number;
  }
  interface Pointer {
    value: Location;
    valueEnd: Location;
    key?: Location;
    keyEnd?: Location;
  }
  interface ParseResult<T = unknown> {
    data: T;
    pointers: Record<string, Pointer>;
  }
  export function parse<T = unknown>(json: string): ParseResult<T>;
  export function stringify(
    data: unknown,
    replacer?: unknown,
    space?: number | string | { space?: number | string },
  ): { json: string; pointers: Record<string, Pointer> };
  const _default: { parse: typeof parse; stringify: typeof stringify };
  export default _default;
}
