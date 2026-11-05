import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';

type Shape = z.ZodRawShape;
type Annotations = NonNullable<Parameters<McpServer['registerTool']>[1]['annotations']>;
type Registered = ReturnType<McpServer['registerTool']>;

export type ToolHandler<S extends Shape> = (args: z.output<z.ZodObject<S>>) => unknown;

export interface ResourceContents {
  contents: { uri: string; mimeType?: string; text: string }[];
}

export interface Registrar {
  tool<S extends Shape>(name: string, description: string, schema: S, cb: ToolHandler<S>): Registered;
  tool<S extends Shape>(name: string, description: string, schema: S, annotations: Annotations, cb: ToolHandler<S>): Registered;
  resource(name: string, uri: string, cb: (uri: URL) => ResourceContents | Promise<ResourceContents>): unknown;
}

export function isRawShape(o: unknown): o is Shape {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return false;
  return Object.values(o).every(v => typeof v === 'object' && v !== null && ('_zod' in v || '_def' in v));
}

/** No tool on this server writes, sends a transaction or holds a key; clients and directories read this as the server's read/write class. */
const READ_ONLY: Annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

/** `allow` decides which names are offered; a tool it refuses is not registered at all. */
export function registrarFor(sdk: McpServer, allow: (name: string) => boolean = () => true): Registrar {
  const tool = (name: string, ...rest: unknown[]): Registered => {
    if (!allow(name)) return undefined as unknown as Registered;
    const cb = rest.pop();
    if (typeof cb !== 'function') throw new Error(`tool ${name} was registered without a handler`);
    const description = typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;
    const inputSchema = isRawShape(rest[0]) ? (rest.shift() as Shape) : {};
    const declared = rest.length > 0 ? (rest.shift() as Annotations) : undefined;
    const annotations: Annotations = { ...READ_ONLY, ...declared };
    const register = sdk.registerTool.bind(sdk) as (n: string, config: object, handler: unknown) => Registered;
    return register(name, { description, inputSchema, annotations }, cb);
  };
  const resource = (name: string, uri: string, cb: (uri: URL) => ResourceContents | Promise<ResourceContents>): unknown =>
    (sdk.registerResource.bind(sdk) as (n: string, u: string, config: object, read: unknown) => unknown)(name, uri, {}, cb);
  return { tool, resource } as Registrar;
}
