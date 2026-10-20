import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP protocol readback: start the real built server over stdio and read the
 * tools/list payload the provider integration actually exposes (KOMAA-1102).
 */

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['build/index.js'],
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    PATH: process.env.PATH,
    MAUTIC_BASE_URL: 'http://127.0.0.1:9/api/',
    MAUTIC_CLIENT_ID: 'contract-test',
    MAUTIC_CLIENT_SECRET: 'contract-test',
    MAUTIC_TOKEN_ENDPOINT: 'http://127.0.0.1:9/oauth/v2/token',
  },
  stderr: 'ignore',
});

const client = new Client({ name: 'komaa-1102-contract-test', version: '1.0.0' });

test('the running MCP server exposes the patched email-create contract', async (t) => {
  await client.connect(transport);
  t.after(async () => {
    await client.close();
  });

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);

  const createEmail = tools.find((tool) => tool.name === 'create_email_template');
  assert.ok(createEmail, 'create_email_template must be exposed over MCP');
  assert.equal(
    createEmail.inputSchema.properties.isPublished.type,
    'boolean',
    'the MCP schema must stay ergonomic (boolean) — the conversion happens at the API boundary',
  );
  assert.deepEqual(createEmail.inputSchema.required, ['name', 'subject']);
  assert.deepEqual(createEmail.inputSchema.properties.emailType.enum, ['template', 'list']);

  for (const name of [
    'list_emails',
    'get_email',
    'create_tag',
    'add_contact_tags',
    'create_campaign_with_automation',
    'list_tags',
    'list_segments',
    'list_campaigns',
    'send_email',
    'send_email_to_segment',
  ]) {
    assert.ok(names.includes(name), `missing tool over MCP: ${name}`);
  }

  // Campaign write contract over the real transport: the schema stays ergonomic
  // and the risk annotations tell a client that the tool mutates the provider.
  const createCampaign = tools.find((tool) => tool.name === 'create_campaign');
  assert.ok(createCampaign, 'create_campaign must be exposed over MCP');
  assert.equal(createCampaign.inputSchema.properties.isPublished.type, 'boolean');
  assert.deepEqual(createCampaign.inputSchema.required, ['name']);
  assert.notEqual(
    createCampaign.annotations?.readOnlyHint,
    true,
    'create_campaign mutates the provider and must not be announced as read-only',
  );

  const createAutomation = tools.find((tool) => tool.name === 'create_campaign_with_automation');
  assert.ok(createAutomation, 'create_campaign_with_automation must be exposed over MCP');
  assert.equal(createAutomation.inputSchema.properties.isPublished.type, 'boolean');
  assert.equal(createAutomation.inputSchema.properties.allowRestart.type, 'boolean');
  assert.deepEqual(createAutomation.inputSchema.required, ['name']);
  assert.notEqual(
    createAutomation.annotations?.readOnlyHint,
    true,
    'create_campaign_with_automation mutates the provider and must not be announced as read-only',
  );

  const listCampaigns = tools.find((tool) => tool.name === 'list_campaigns');
  assert.equal(listCampaigns.annotations?.readOnlyHint, true, 'list_campaigns is read-only');

  const addContactTags = tools.find((tool) => tool.name === 'add_contact_tags');
  assert.notEqual(
    addContactTags.annotations?.readOnlyHint,
    true,
    'add_contact_tags mutates a contact and must not be announced as read-only',
  );

  console.log(
    JSON.stringify(
      {
        toolCount: tools.length,
        createEmailTemplateSchema: createEmail.inputSchema,
        createCampaignSchema: createCampaign.inputSchema,
        createCampaignWithAutomationSchema: createAutomation.inputSchema,
      },
      null,
      2,
    ),
  );
});
