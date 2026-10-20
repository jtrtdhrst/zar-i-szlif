import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Mautic 7 API-boundary contract for email creation.
 *
 * Root cause of the provider HTTP 500 (KOMAA-1082 / KOMAA-1102):
 * Mautic 7 binds `isPublished` as `YesNoButtonGroupType` (int choices 0/1).
 * Symfony 7.4 `ChoiceToValueTransformer::reverseTransform()` throws
 * `TransformationFailedException('Expected a string or null.')` for any
 * non-string value, and `CommonApiController::processForm()` submits the form
 * without a try/catch, so the exception escapes as HTTP 500 instead of a 400
 * validation error. The wire value must therefore be the STRING "0" or "1".
 *
 * The MCP tool keeps the ergonomic boolean schema and converts at this
 * boundary. Raw HTML and Mautic personalization tokens are never rewritten.
 */

export class MauticContractError extends McpError {
  readonly contractCode: string;
  readonly field: string | undefined;

  constructor(
    contractCode: string,
    message: string,
    field?: string,
    code: ErrorCode = ErrorCode.InvalidParams,
  ) {
    super(code, message, { contractCode, field });
    this.contractCode = contractCode;
    this.field = field;
    this.name = 'MauticContractError';
  }
}

/** Mautic 7 email types accepted by the `emailType` field. */
export const MAUTIC_EMAIL_TYPES: readonly string[] = ['template', 'list'];

/** Fields the create-email form supports. Anything else is rejected. */
export const SUPPORTED_EMAIL_CREATE_FIELDS: readonly string[] = [
  'name',
  'subject',
  'fromAddress',
  'fromName',
  'replyToAddress',
  'customHtml',
  'plainText',
  'emailType',
  'isPublished',
];

const OPTIONAL_STRING_FIELDS = [
  'fromAddress',
  'fromName',
  'replyToAddress',
  'customHtml',
  'plainText',
] as const;

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Convert the ergonomic boolean to the Mautic 7 wire value.
 * Missing means "not specified" and becomes a safe draft ("0").
 */
export function normalizeIsPublished(value: unknown): '0' | '1' {
  if (value === undefined || value === null) return '0';
  if (typeof value !== 'boolean') {
    throw new MauticContractError(
      'invalid_is_published_type',
      `isPublished must be a boolean (true or false); received ${describeType(value)}. ` +
        'Mautic 7 expects the wire value "1" (published) or "0" (draft); this tool converts it automatically.',
      'isPublished',
    );
  }
  return value ? '1' : '0';
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new MauticContractError(
      'invalid_field_type',
      `${field} must be a string; received ${describeType(value)}.`,
      field,
    );
  }
  if (value.trim() === '') {
    throw new MauticContractError('empty_field', `${field} must not be empty.`, field);
  }
  return value;
}

/**
 * Validate tool arguments and build the exact Mautic 7 form payload.
 * Throws a typed MauticContractError BEFORE any provider call.
 */
export function buildEmailCreatePayload(args: unknown): Record<string, string> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new MauticContractError(
      'invalid_arguments',
      'create_email_template expects an object of arguments.',
    );
  }
  const input = args as Record<string, unknown>;

  const unknownFields = Object.keys(input).filter(
    (key) => !SUPPORTED_EMAIL_CREATE_FIELDS.includes(key),
  );
  if (unknownFields.length > 0) {
    throw new MauticContractError(
      'unsupported_field',
      `Unsupported field(s): ${unknownFields.join(', ')}. ` +
        `Supported fields: ${SUPPORTED_EMAIL_CREATE_FIELDS.join(', ')}. ` +
        'Recipient, segment and campaign fields are intentionally not supported by create_email_template.',
      unknownFields[0],
    );
  }

  const name = requireNonEmptyString(input.name, 'name');
  const subject = requireNonEmptyString(input.subject, 'subject');

  let emailType = 'template';
  if (input.emailType !== undefined && input.emailType !== null) {
    if (typeof input.emailType !== 'string' || !MAUTIC_EMAIL_TYPES.includes(input.emailType)) {
      throw new MauticContractError(
        'invalid_email_type',
        `emailType must be one of: ${MAUTIC_EMAIL_TYPES.join(', ')}.`,
        'emailType',
      );
    }
    emailType = input.emailType;
  }

  const payload: Record<string, string> = {
    name,
    subject,
    emailType,
    isPublished: normalizeIsPublished(input.isPublished),
  };

  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new MauticContractError(
        'invalid_field_type',
        `${field} must be a string; received ${describeType(value)}.`,
        field,
      );
    }
    // Verbatim: raw HTML and Mautic personalization tokens are never rewritten.
    payload[field] = value;
  }

  return payload;
}

/**
 * Find emails whose name matches exactly. Used for idempotent create and for
 * reconciling an ambiguous provider failure before any retry.
 */
export async function findEmailsByExactName(client: any, name: string): Promise<any[]> {
  const pageSize = 200;
  const maxPages = 10;
  const matches: any[] = [];
  const wanted = name.trim();

  for (let page = 0; page < maxPages; page++) {
    const response = await client.v1.get('/emails', {
      params: { search: name, limit: pageSize, start: page * pageSize },
    });
    const data = response?.data ?? {};
    const emails: any[] = Array.isArray(data.emails) ? data.emails : [];
    for (const email of emails) {
      if (email && typeof email.name === 'string' && email.name.trim() === wanted) {
        matches.push(email);
      }
    }
    if (emails.length < pageSize) break;
    if (typeof data.total === 'number' && (page + 1) * pageSize >= data.total) break;
  }

  return matches;
}

/** Best-effort provider message extraction for error surfacing. */
export function extractProviderMessage(error: any): string {
  const data = error?.response?.data;
  return (
    data?.errors?.[0]?.message ||
    data?.error?.message ||
    data?.['hydra:description'] ||
    data?.detail ||
    error?.message ||
    'unknown error'
  );
}
