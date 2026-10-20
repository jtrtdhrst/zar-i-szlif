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

  console.log(
    JSON.stringify(
      {
        toolCount: tools.length,
        createEmailTemplateSchema: createEmail.inputSchema,
      },
      null,
      2,
    ),
  );
});
