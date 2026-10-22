export interface OAuth2Token {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
}

export interface ApiPlatformCollection<T> {
  '@context': string;
  '@id': string;
  '@type': string;
  'hydra:totalItems': number;
  'hydra:member': T[];
  'hydra:view'?: {
    '@id': string;
    '@type': string;
    'hydra:first'?: string;
    'hydra:last'?: string;
    'hydra:next'?: string;
    'hydra:previous'?: string;
  };
}

export interface ToolAnnotations {
  /** Human-readable title for the tool. */
  title?: string;
  /** True when the tool only reads and never modifies provider state. */
  readOnlyHint?: boolean;
  /** True when the tool may perform destructive updates (meaningful only when readOnlyHint is false). */
  destructiveHint?: boolean;
  /** True when repeated calls with the same arguments have no additional effect. */
  idempotentHint?: boolean;
  /** True when the tool interacts with an external system (the Mautic provider). */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  /**
   * Risk hints for MCP clients and tool catalogs. A tool that mutates the
   * provider must not be classified as read-only (the MCP spec defaults
   * readOnlyHint to false when the annotation is absent).
   */
  annotations?: ToolAnnotations;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (client: any, args: any) => Promise<ToolResult>;
