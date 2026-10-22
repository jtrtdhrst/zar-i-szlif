import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import {
  buildCampaignAutomationPayload,
  buildCampaignCreatePayload,
  extractProviderMessage,
  findCampaignsByExactName,
  MauticContractError,
} from './mautic-contract.js';

export const toolDefinitions: ToolDefinition[] = [
  // Existing campaign tools
  {
    name: 'list_campaigns',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Get all campaigns with status and statistics',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published campaigns' },
      },
    },
  },
  {
    name: 'get_campaign',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Get detailed campaign information',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Campaign ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_campaign',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      'Create a new campaign (draft by default, idempotent on the exact campaign name). isPublished is a boolean and is converted to the Mautic 7 wire string "0"/"1"; omitted means draft.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        description: { type: 'string', description: 'Campaign description' },
        isPublished: { type: 'boolean', description: 'Publish immediately' },
        publishUp: { type: 'string', description: 'Publish start date (YYYY-MM-DD HH:MM:SS)' },
        publishDown: { type: 'string', description: 'Publish end date (YYYY-MM-DD HH:MM:SS)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_contact_to_campaign',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    description: 'Add a contact to a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        contactId: { type: 'number', description: 'Contact ID' },
      },
      required: ['campaignId', 'contactId'],
    },
  },
  {
    name: 'create_campaign_with_automation',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    description:
      'Create campaign with full event automation including triggers, actions, and canvas settings (draft by default, idempotent on the exact campaign name). isPublished is a boolean and is converted to the Mautic 7 wire string "0"/"1"; omitted means draft.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        description: { type: 'string', description: 'Campaign description' },
        isPublished: { type: 'boolean', description: 'Publish immediately' },
        allowRestart: { type: 'boolean', description: 'Allow campaign restart' },
        events: {
          type: 'array',
          description: 'Array of campaign events (triggers/actions)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Event ID (use new1, new2, etc.)' },
              name: { type: 'string', description: 'Event name' },
              type: { type: 'string', description: 'Event type (e.g., email.send, lead.field_value)' },
              eventType: { type: 'string', enum: ['action', 'condition', 'decision'] },
              order: { type: 'number', description: 'Event order' },
              properties: { type: 'object', description: 'Event-specific properties' },
              triggerMode: { type: 'string', enum: ['immediate', 'interval'] },
              triggerInterval: { type: 'number' },
              triggerIntervalUnit: { type: 'string', enum: ['i', 'h', 'd', 'm', 'y'] },
              decisionPath: { type: 'string', enum: ['yes', 'no'] },
              parent: { type: 'object', properties: { id: { type: 'string' } } },
            },
          },
        },
        segments: { type: 'array', description: 'Segment IDs to trigger campaign', items: { type: 'number' } },
        forms: { type: 'array', description: 'Form IDs to trigger campaign', items: { type: 'number' } },
        canvasSettings: { type: 'object', description: 'Visual campaign builder settings' },
      },
      required: ['name'],
    },
  },
  {
    name: 'execute_campaign',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    description: 'Manually execute/trigger a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        contactIds: { type: 'array', items: { type: 'number' }, description: 'Optional: specific contacts' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'get_campaign_contacts',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Get contacts in a campaign with their status',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        start: { type: 'number', description: 'Starting offset' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
      },
      required: ['campaignId'],
    },
  },

  // NEW Mautic 7 campaign tools
  {
    name: 'clone_campaign',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description: 'Clone an existing campaign (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'ID of the campaign to clone' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'export_campaign',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Export campaign data with all related assets (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID to export' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'import_campaign',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    description: 'Import a campaign from JSON data (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignData: { type: 'object', description: 'Campaign JSON data to import' },
      },
      required: ['campaignData'],
    },
  },
  {
    name: 'get_campaign_event_details',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Get detailed metrics for a specific campaign event (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'number', description: 'Campaign event ID' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'get_campaign_graph_stats',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Get campaign graph statistics for a date range (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['campaignId', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'get_campaign_map_stats',
    annotations: { readOnlyHint: true, openWorldHint: true },
    description: 'Get campaign geographic map statistics for a date range (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['campaignId', 'dateFrom', 'dateTo'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async list_campaigns(client: MauticApiClient, args: any) {
    const params: any = {};
    if (args?.search) params.search = args.search;
    if (args?.limit) params.limit = Math.min(args.limit, 200);
    if (args?.start) params.start = args.start;
    if (args?.publishedOnly) params.publishedOnly = args.publishedOnly;

    const response = await client.v1.get('/campaigns', { params });
    return {
      content: [{ type: 'text', text: `Found ${response.data.total} campaigns:\n${JSON.stringify(response.data.campaigns, null, 2)}` }],
    };
  },

  async get_campaign(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/campaigns/${id}`);
    return {
      content: [{ type: 'text', text: `Campaign details:\n${JSON.stringify(response.data.campaign, null, 2)}` }],
    };
  },

  async create_campaign(client: MauticApiClient, args: any) {
    // Validate + normalize BEFORE the provider call: isPublished is a boolean
    // here and the STRING "0"/"1" on the wire (Mautic 7 / Symfony
    // ChoiceToValueTransformer rejects non-strings and answers HTTP 500).
    const payload = buildCampaignCreatePayload(args);

    // Idempotent create: a campaign with this exact name already exists ->
    // reuse it, never write a duplicate.
    const existing = await findCampaignsByExactName(client, payload.name);
    if (existing.length === 1) {
      return {
        content: [
          {
            type: 'text',
            text: `Campaign already exists (idempotent create, nothing written):\n${JSON.stringify(existing[0], null, 2)}`,
          },
        ],
      };
    }
    if (existing.length > 1) {
      throw new MauticContractError(
        'ambiguous_existing_campaign',
        `Found ${existing.length} existing campaigns named "${payload.name}". Refusing to create a duplicate; resolve them with list_campaigns/get_campaign first.`,
        'name',
        ErrorCode.InvalidRequest,
      );
    }

    try {
      const response = await client.v1.post('/campaigns/new', payload);
      return {
        content: [{ type: 'text', text: `Campaign created successfully:\n${JSON.stringify(response.data.campaign, null, 2)}` }],
      };
    } catch (error: any) {
      const status = error?.response?.status;
      if (typeof status === 'number' && status >= 500) {
        // Ambiguous outcome: reconcile by exact name before any retry so we never duplicate.
        const reconciled = await findCampaignsByExactName(client, payload.name);
        if (reconciled.length === 1) {
          return {
            content: [
              {
                type: 'text',
                text: `Mautic API returned ${status} but the campaign exists (reconciled by exact name, no duplicate written):\n${JSON.stringify(reconciled[0], null, 2)}`,
              },
            ],
          };
        }
        throw new MauticContractError(
          'mautic_server_error',
          `Mautic API Error ${status}: server error while creating campaign "${payload.name}". ` +
            'No campaign with this exact name exists after the failure, so nothing was created. ' +
            'Do not blind-retry — reconcile with list_campaigns first. ' +
            `Provider message: ${extractProviderMessage(error)}`,
          undefined,
          ErrorCode.InternalError,
        );
      }
      throw error;
    }
  },

  async add_contact_to_campaign(client: MauticApiClient, args: any) {
    const { campaignId, contactId } = args;
    await client.v1.post(`/campaigns/${campaignId}/contact/${contactId}/add`);
    return {
      content: [{ type: 'text', text: `Contact ${contactId} added to campaign ${campaignId} successfully` }],
    };
  },

  async create_campaign_with_automation(client: MauticApiClient, args: any) {
    // Validate + normalize BEFORE the provider call (see create_campaign).
    const payload = buildCampaignAutomationPayload(args);

    const existing = await findCampaignsByExactName(client, payload.name);
    if (existing.length === 1) {
      return {
        content: [
          {
            type: 'text',
            text: `Campaign already exists (idempotent create, nothing written):\n${JSON.stringify(existing[0], null, 2)}`,
          },
        ],
      };
    }
    if (existing.length > 1) {
      throw new MauticContractError(
        'ambiguous_existing_campaign',
        `Found ${existing.length} existing campaigns named "${payload.name}". Refusing to create a duplicate; resolve them with list_campaigns/get_campaign first.`,
        'name',
        ErrorCode.InvalidRequest,
      );
    }

    try {
      const response = await client.v1.post('/campaigns/new', payload);
      return {
        content: [{ type: 'text', text: `Campaign with automation created successfully:\n${JSON.stringify(response.data.campaign, null, 2)}` }],
      };
    } catch (error: any) {
      const status = error?.response?.status;
      if (typeof status === 'number' && status >= 500) {
        const reconciled = await findCampaignsByExactName(client, payload.name);
        if (reconciled.length === 1) {
          return {
            content: [
              {
                type: 'text',
                text: `Mautic API returned ${status} but the campaign exists (reconciled by exact name, no duplicate written):\n${JSON.stringify(reconciled[0], null, 2)}`,
              },
            ],
          };
        }
        throw new MauticContractError(
          'mautic_server_error',
          `Mautic API Error ${status}: server error while creating campaign "${payload.name}". ` +
            'No campaign with this exact name exists after the failure, so nothing was created. ' +
            'Do not blind-retry — reconcile with list_campaigns first. ' +
            `Provider message: ${extractProviderMessage(error)}`,
          undefined,
          ErrorCode.InternalError,
        );
      }
      throw error;
    }
  },

  async execute_campaign(client: MauticApiClient, args: any) {
    const { campaignId, contactIds } = args;
    const payload: any = {};
    if (contactIds?.length > 0) payload.contactIds = contactIds;

    const response = await client.v1.post(`/campaigns/${campaignId}/trigger`, payload);
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} executed successfully:\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  async get_campaign_contacts(client: MauticApiClient, args: any) {
    const { campaignId, start, limit } = args;
    const params: any = {};
    if (start) params.start = start;
    if (limit) params.limit = Math.min(limit, 200);

    const response = await client.v1.get(`/campaigns/${campaignId}/contacts`, { params });
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} contacts:\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  // NEW Mautic 7 handlers
  async clone_campaign(client: MauticApiClient, args: any) {
    const { campaignId } = args;
    const response = await client.v1.post(`/campaigns/clone/${campaignId}`);
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} cloned successfully:\n${JSON.stringify(response.data.campaign || response.data, null, 2)}` }],
    };
  },

  async export_campaign(client: MauticApiClient, args: any) {
    const { campaignId } = args;
    const response = await client.v1.get(`/campaigns/export/${campaignId}`);
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} export data:\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  async import_campaign(client: MauticApiClient, args: any) {
    const { campaignData } = args;
    const response = await client.v1.post('/campaigns/import', campaignData);
    return {
      content: [{ type: 'text', text: `Campaign imported successfully:\n${JSON.stringify(response.data.campaign || response.data, null, 2)}` }],
    };
  },

  async get_campaign_event_details(client: MauticApiClient, args: any) {
    const { eventId, limit, start } = args;
    const params: any = {};
    if (limit) params.limit = Math.min(limit, 200);
    if (start) params.start = start;

    const response = await client.v1.get(`/campaigns/events/${eventId}`, { params });
    return {
      content: [{ type: 'text', text: `Campaign event ${eventId} details:\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  async get_campaign_graph_stats(client: MauticApiClient, args: any) {
    const { campaignId, dateFrom, dateTo } = args;
    const response = await client.v1.get(`/campaigns/${campaignId}`, {
      params: { dateFrom, dateTo },
    });
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  async get_campaign_map_stats(client: MauticApiClient, args: any) {
    const { campaignId, dateFrom, dateTo } = args;
    const response = await client.v1.get(`/campaigns/${campaignId}`, {
      params: { dateFrom, dateTo },
    });
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} map stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },
};
