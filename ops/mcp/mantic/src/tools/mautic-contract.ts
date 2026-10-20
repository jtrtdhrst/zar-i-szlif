import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Mautic 7 API-boundary contract for email, campaign and tag creation.
 *
 * Root cause of the provider HTTP 500 (KOMAA-1082 / KOMAA-1102):
 * Mautic 7 binds `isPublished` as `YesNoButtonGroupType` (int choices 0/1).
 * Symfony 7.4 `ChoiceToValueTransformer::reverseTransform()` throws
 * `TransformationFailedException('Expected a string or null.')` for any
 * non-string value, and `CommonApiController::processForm()` submits the form
 * without a try/catch, so the exception escapes as HTTP 500 instead of a 400
 * validation error. The wire value must therefore be the STRING "0" or "1".
 *
 * The same defect applies to every YesNoButtonGroupType field of the campaign
 * form (`isPublished`, `allowRestart`), so both campaign handlers use the same
 * boundary conversion.
 *
 * The MCP tool keeps the ergonomic boolean schema and converts at this
 * boundary. Raw HTML and Mautic personalization tokens are never rewritten.
 *
 * Safety rules enforced here (never in the consumer payload):
 *  - a create never publishes silently (missing isPublished => "0" = draft);
 *  - unknown fields are rejected instead of being forwarded verbatim;
 *  - a campaign is never created published *with* an audience or a publish
 *    window, because that is the only path in this tool that can send;
 *  - campaign event order and interval/delay configuration are validated;
 *  - creates are idempotent on the exact name and an ambiguous 5xx is
 *    reconciled by exact name before any retry.
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

/** Options for the paginated exact-name lookup. */
export interface ExactNameSearchOptions {
  /** v1 collection path, e.g. `/emails`. */
  path: string;
  /** Key holding the collection in the v1 response, e.g. `emails`. */
  collectionKey: string;
  /** Field holding the name, e.g. `name` (campaigns) or `tag` (tags). */
  nameField: string;
}

/**
 * Find entities whose name matches exactly (case/whitespace trimmed).
 * Used for idempotent create and for reconciling an ambiguous provider
 * failure before any retry.
 */
export async function findByExactName(
  client: any,
  options: ExactNameSearchOptions,
  name: string,
): Promise<any[]> {
  const pageSize = 200;
  const maxPages = 10;
  const matches: any[] = [];
  const wanted = name.trim();

  for (let page = 0; page < maxPages; page++) {
    const response = await client.v1.get(options.path, {
      params: { search: name, limit: pageSize, start: page * pageSize },
    });
    const data = response?.data ?? {};
    const items: any[] = Array.isArray(data[options.collectionKey])
      ? data[options.collectionKey]
      : Array.isArray(data['hydra:member'])
        ? data['hydra:member']
        : [];
    for (const item of items) {
      const value = item?.[options.nameField];
      if (typeof value === 'string' && value.trim() === wanted) {
        matches.push(item);
      }
    }
    if (items.length < pageSize) break;
    const total =
      typeof data.total === 'number'
        ? data.total
        : typeof data['hydra:totalItems'] === 'number'
          ? data['hydra:totalItems']
          : undefined;
    if (total !== undefined && (page + 1) * pageSize >= total) break;
  }

  return matches;
}

/** Find emails whose name matches exactly. */
export async function findEmailsByExactName(client: any, name: string): Promise<any[]> {
  return findByExactName(client, { path: '/emails', collectionKey: 'emails', nameField: 'name' }, name);
}

/** Find campaigns whose name matches exactly. */
export async function findCampaignsByExactName(client: any, name: string): Promise<any[]> {
  return findByExactName(
    client,
    { path: '/campaigns', collectionKey: 'campaigns', nameField: 'name' },
    name,
  );
}

/** Find tags whose tag name matches exactly. */
export async function findTagsByExactName(client: any, tag: string): Promise<any[]> {
  return findByExactName(client, { path: '/tags', collectionKey: 'tags', nameField: 'tag' }, tag);
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

/* -------------------------------------------------------------------------- */
/* Campaign write contract                                                    */
/* -------------------------------------------------------------------------- */

/** Fields accepted by the plain `create_campaign` form. */
export const SUPPORTED_CAMPAIGN_CREATE_FIELDS: readonly string[] = [
  'name',
  'description',
  'isPublished',
  'publishUp',
  'publishDown',
];

/** Fields accepted by `create_campaign_with_automation`. */
export const SUPPORTED_CAMPAIGN_AUTOMATION_FIELDS: readonly string[] = [
  'name',
  'description',
  'isPublished',
  'allowRestart',
  'events',
  'segments',
  'forms',
  'canvasSettings',
];

/** Fields accepted inside a single campaign event. */
export const SUPPORTED_CAMPAIGN_EVENT_FIELDS: readonly string[] = [
  'id',
  'name',
  'type',
  'eventType',
  'order',
  'properties',
  'triggerMode',
  'triggerInterval',
  'triggerIntervalUnit',
  'decisionPath',
  'parent',
];

/** Mautic campaign event types. */
export const MAUTIC_CAMPAIGN_EVENT_TYPES: readonly string[] = ['action', 'condition', 'decision'];

/** Mautic campaign trigger modes. */
export const MAUTIC_CAMPAIGN_TRIGGER_MODES: readonly string[] = ['immediate', 'interval'];

/** Mautic campaign interval units (i/h/d/m/y). */
export const MAUTIC_CAMPAIGN_INTERVAL_UNITS: readonly string[] = ['i', 'h', 'd', 'm', 'y'];

/** Mautic publish window format used by `publishUp` / `publishDown`. */
const MAUTIC_PUBLISH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function requireArgs(args: unknown, toolName: string): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new MauticContractError(
      'invalid_arguments',
      `${toolName} expects an object of arguments.`,
    );
  }
  return args as Record<string, unknown>;
}

function assertSupportedFields(
  input: Record<string, unknown>,
  supported: readonly string[],
  toolName: string,
  hint: string,
): void {
  const unknownFields = Object.keys(input).filter((key) => !supported.includes(key));
  if (unknownFields.length > 0) {
    throw new MauticContractError(
      'unsupported_field',
      `Unsupported field(s) for ${toolName}: ${unknownFields.join(', ')}. ` +
        `Supported fields: ${supported.join(', ')}. ${hint}`,
      unknownFields[0],
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new MauticContractError(
      'invalid_field_type',
      `${field} must be a string; received ${describeType(value)}.`,
      field,
    );
  }
  return value;
}

function requirePublishDate(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (!MAUTIC_PUBLISH_DATE_PATTERN.test(text)) {
    throw new MauticContractError(
      'invalid_publish_date',
      `${field} must use the Mautic format "YYYY-MM-DD HH:MM:SS"; received "${text}".`,
      field,
    );
  }
  return text;
}

/**
 * `allowRestart` is a YesNoButtonGroupType on the Mautic campaign form, so it
 * needs the same string conversion as `isPublished`. Booleans stay ergonomic;
 * the form-bound strings "0"/"1" are accepted for callers that already work
 * with the wire format.
 */
export function normalizeAllowRestart(value: unknown): '0' | '1' {
  if (value === undefined || value === null) return '0';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === '0' || value === '1') return value;
  throw new MauticContractError(
    'invalid_allow_restart_type',
    `allowRestart must be a boolean (true or false) or the wire string "0"/"1"; ` +
      `received ${describeType(value)}. Mautic 7 expects the wire value "1" or "0"; ` +
      'this tool converts booleans automatically.',
    'allowRestart',
  );
}

/** Validate a list of Mautic entity IDs (segments, forms). */
export function validateIdArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) {
    throw new MauticContractError(
      'invalid_id_list',
      `${field} must be an array of numeric Mautic IDs.`,
      field,
    );
  }
  const ids: number[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item <= 0) {
      throw new MauticContractError(
        'invalid_id_list',
        `${field}[${index}] must be a positive integer Mautic ID; received ${JSON.stringify(item)}.`,
        field,
      );
    }
    if (ids.includes(item)) {
      throw new MauticContractError(
        'duplicate_id',
        `${field} contains the duplicate ID ${item}.`,
        field,
      );
    }
    ids.push(item);
  }
  return ids;
}

/**
 * Validate the campaign event sequence: known fields only, a unique and
 * ascending execution order, and a delay that is only allowed on an interval
 * trigger (a delay on an immediate trigger would be silently ignored).
 */
export function validateCampaignEvents(value: unknown): any[] {
  if (!Array.isArray(value)) {
    throw new MauticContractError(
      'invalid_events',
      'events must be an array of campaign events.',
      'events',
    );
  }

  const orders: number[] = [];

  const events = value.map((event, index) => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new MauticContractError(
        'invalid_event',
        `events[${index}] must be an object.`,
        'events',
      );
    }
    const current = event as Record<string, unknown>;

    const unknownFields = Object.keys(current).filter(
      (key) => !SUPPORTED_CAMPAIGN_EVENT_FIELDS.includes(key),
    );
    if (unknownFields.length > 0) {
      throw new MauticContractError(
        'unsupported_field',
        `Unsupported field(s) in events[${index}]: ${unknownFields.join(', ')}. ` +
          `Supported event fields: ${SUPPORTED_CAMPAIGN_EVENT_FIELDS.join(', ')}.`,
        'events',
      );
    }

    const order = current.order;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0) {
      throw new MauticContractError(
        'invalid_event_order',
        `events[${index}].order must be a non-negative integer; received ${JSON.stringify(order)}.`,
        'events',
      );
    }
    orders.push(order);

    for (const field of ['id', 'name', 'type'] as const) {
      const fieldValue = current[field];
      if (fieldValue === undefined) continue;
      if (typeof fieldValue !== 'string' || fieldValue.trim() === '') {
        throw new MauticContractError(
          'invalid_field_type',
          `events[${index}].${field} must be a non-empty string.`,
          'events',
        );
      }
    }

    if (
      current.eventType !== undefined &&
      !MAUTIC_CAMPAIGN_EVENT_TYPES.includes(current.eventType as string)
    ) {
      throw new MauticContractError(
        'invalid_event_type',
        `events[${index}].eventType must be one of: ${MAUTIC_CAMPAIGN_EVENT_TYPES.join(', ')}.`,
        'events',
      );
    }

    if (
      current.decisionPath !== undefined &&
      !['yes', 'no'].includes(current.decisionPath as string)
    ) {
      throw new MauticContractError(
        'invalid_decision_path',
        `events[${index}].decisionPath must be "yes" or "no".`,
        'events',
      );
    }

    if (
      current.triggerMode !== undefined &&
      !MAUTIC_CAMPAIGN_TRIGGER_MODES.includes(current.triggerMode as string)
    ) {
      throw new MauticContractError(
        'invalid_trigger_mode',
        `events[${index}].triggerMode must be one of: ${MAUTIC_CAMPAIGN_TRIGGER_MODES.join(', ')}.`,
        'events',
      );
    }

    const wantsDelay = current.triggerMode === 'interval';
    if (wantsDelay) {
      const interval = current.triggerInterval;
      if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
        throw new MauticContractError(
          'invalid_event_interval',
          `events[${index}] uses triggerMode "interval" and needs a positive triggerInterval; ` +
            `received ${JSON.stringify(interval)}.`,
          'events',
        );
      }
      const unit = current.triggerIntervalUnit;
      if (typeof unit !== 'string' || !MAUTIC_CAMPAIGN_INTERVAL_UNITS.includes(unit)) {
        throw new MauticContractError(
          'invalid_event_interval',
          `events[${index}].triggerIntervalUnit must be one of: ${MAUTIC_CAMPAIGN_INTERVAL_UNITS.join(', ')}.`,
          'events',
        );
      }
    } else if (current.triggerInterval !== undefined || current.triggerIntervalUnit !== undefined) {
      throw new MauticContractError(
        'invalid_event_interval',
        `events[${index}] sets a delay but triggerMode is not "interval"; the delay would be silently ignored.`,
        'events',
      );
    }

    if (
      current.properties !== undefined &&
      (current.properties === null ||
        typeof current.properties !== 'object' ||
        Array.isArray(current.properties))
    ) {
      throw new MauticContractError(
        'invalid_field_type',
        `events[${index}].properties must be an object.`,
        'events',
      );
    }

    if (current.parent !== undefined) {
      const parent = current.parent as Record<string, unknown> | null;
      if (
        parent === null ||
        typeof parent !== 'object' ||
        Array.isArray(parent) ||
        typeof parent.id !== 'string' ||
        parent.id.trim() === ''
      ) {
        throw new MauticContractError(
          'invalid_field_type',
          `events[${index}].parent must be an object with a non-empty string id.`,
          'events',
        );
      }
    }

    return current;
  });

  if (new Set(orders).size !== orders.length) {
    throw new MauticContractError(
      'duplicate_event_order',
      `Campaign events need unique order values; received ${orders.join(', ')}.`,
      'events',
    );
  }

  for (let index = 1; index < orders.length; index++) {
    if (orders[index] <= orders[index - 1]) {
      throw new MauticContractError(
        'invalid_event_order',
        `Campaign events must be listed in ascending execution order; ` +
          `events[${index}].order (${orders[index]}) must be greater than ` +
          `events[${index - 1}].order (${orders[index - 1]}).`,
        'events',
      );
    }
  }

  return events;
}

/**
 * Build the exact Mautic 7 campaign payload for `create_campaign`.
 * Throws a typed MauticContractError BEFORE any provider call.
 */
export function buildCampaignCreatePayload(args: unknown): Record<string, any> {
  const input = requireArgs(args, 'create_campaign');
  assertSupportedFields(
    input,
    SUPPORTED_CAMPAIGN_CREATE_FIELDS,
    'create_campaign',
    'Segment, form and event fields are only accepted by create_campaign_with_automation.',
  );

  const payload: Record<string, any> = {
    name: requireNonEmptyString(input.name, 'name'),
    isPublished: normalizeIsPublished(input.isPublished),
  };

  if (input.description !== undefined && input.description !== null) {
    payload.description = requireString(input.description, 'description');
  }

  const publishUp = input.publishUp === undefined || input.publishUp === null ? undefined : requirePublishDate(input.publishUp, 'publishUp');
  const publishDown = input.publishDown === undefined || input.publishDown === null ? undefined : requirePublishDate(input.publishDown, 'publishDown');
  if (publishUp !== undefined) payload.publishUp = publishUp;
  if (publishDown !== undefined) payload.publishDown = publishDown;

  if (payload.isPublished === '1' && (publishUp !== undefined || publishDown !== undefined)) {
    throw new MauticContractError(
      'unsafe_published_schedule',
      'A published campaign must not be created with a publish window: the schedule would activate ' +
        'the campaign automatically. Create it as a draft (isPublished omitted or false) and publish it ' +
        'only through a separately reviewed action.',
      'isPublished',
    );
  }

  return payload;
}

/**
 * Build the exact Mautic 7 campaign payload for `create_campaign_with_automation`.
 * Throws a typed MauticContractError BEFORE any provider call.
 */
export function buildCampaignAutomationPayload(args: unknown): Record<string, any> {
  const input = requireArgs(args, 'create_campaign_with_automation');
  assertSupportedFields(
    input,
    SUPPORTED_CAMPAIGN_AUTOMATION_FIELDS,
    'create_campaign_with_automation',
    'Unknown fields are rejected instead of being forwarded verbatim.',
  );

  const payload: Record<string, any> = {
    name: requireNonEmptyString(input.name, 'name'),
    isPublished: normalizeIsPublished(input.isPublished),
    allowRestart: normalizeAllowRestart(input.allowRestart),
  };

  if (input.description !== undefined && input.description !== null) {
    payload.description = requireString(input.description, 'description');
  }

  if (input.events !== undefined && input.events !== null) {
    const events = validateCampaignEvents(input.events);
    if (events.length > 0) payload.events = events;
  }

  let segmentIds: number[] = [];
  if (input.segments !== undefined && input.segments !== null) {
    segmentIds = validateIdArray(input.segments, 'segments');
    if (segmentIds.length > 0) payload.lists = segmentIds.map((id) => ({ id }));
  }

  let formIds: number[] = [];
  if (input.forms !== undefined && input.forms !== null) {
    formIds = validateIdArray(input.forms, 'forms');
    if (formIds.length > 0) payload.forms = formIds.map((id) => ({ id }));
  }

  if (input.canvasSettings !== undefined && input.canvasSettings !== null) {
    const canvas = input.canvasSettings;
    if (typeof canvas !== 'object' || Array.isArray(canvas)) {
      throw new MauticContractError(
        'invalid_field_type',
        'canvasSettings must be an object.',
        'canvasSettings',
      );
    }
    payload.canvasSettings = canvas;
  }

  if (payload.isPublished === '1' && (segmentIds.length > 0 || formIds.length > 0)) {
    throw new MauticContractError(
      'unsafe_published_audience',
      'A published campaign must not be created with an attached audience (segments/forms): ' +
        'publishing plus an audience is the only path in this tool that can send to contacts. ' +
        'Create it as a draft (isPublished omitted or false) and publish it only through a ' +
        'separately reviewed action.',
      'isPublished',
    );
  }

  return payload;
}

/* -------------------------------------------------------------------------- */
/* Tag write contract                                                          */
/* -------------------------------------------------------------------------- */

/** Validate a tag name (non-empty, trimmed, bounded length). */
export function validateTagName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new MauticContractError(
      'invalid_field_type',
      `tag must be a string; received ${describeType(value)}.`,
      'tag',
    );
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new MauticContractError('empty_field', 'tag must not be empty.', 'tag');
  }
  if (trimmed.length > 191) {
    throw new MauticContractError(
      'invalid_field_length',
      `tag must be at most 191 characters; received ${trimmed.length}.`,
      'tag',
    );
  }
  return trimmed;
}

/** Validate the tag names of `add_contact_tags`. */
export function validateTagNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MauticContractError(
      'invalid_tag_list',
      'tags must be a non-empty array of tag names.',
      'tags',
    );
  }
  const tags = value.map((tag) => validateTagName(tag));
  const unique = new Set(tags);
  if (unique.size !== tags.length) {
    throw new MauticContractError('duplicate_tag', 'tags must not contain duplicates.', 'tags');
  }
  return tags;
}

/** Validate a Mautic entity ID argument (positive integer). */
export function validateEntityId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new MauticContractError(
      'invalid_id',
      `${field} must be a positive integer Mautic ID; received ${JSON.stringify(value)}.`,
      field,
    );
  }
  return value;
}
