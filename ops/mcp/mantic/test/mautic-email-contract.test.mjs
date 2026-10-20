import assert from 'node:assert/strict';
import test from 'node:test';

import { toolDefinitions, toolHandlers } from '../build/tools/emails.js';
import { allToolDefinitions } from '../build/tools/index.js';
import { MauticContractError } from '../build/tools/mautic-contract.js';

/**
 * Contract tests for the Mautic 7 email-create write path (KOMAA-1102).
 *
 * The fake MauticApiClient captures the wire body so we can assert what the
 * provider actually receives — the failure that produced HTTP 500 was a JSON
 * boolean in `isPublished` instead of the string "0"/"1".
 */

const HTML = `<!doctype html>
<html><body>
<p>Cześć {{contact.firstname}}, {{contact.email}}</p>
<p>{contactfield=company}</p>
<p>{% if lead.is_customer %}{{ lead.name }}{% endif %}</p>
</body></html>`;

const PLAIN = 'Cześć {{contact.firstname}},\n{contactfield=company}\n';

function createFakeClient({ emails = [], onPost } = {}) {
  const calls = { get: [], post: [] };
  const client = {
    v1: {
      async get(url, config) {
        calls.get.push({ url, params: config?.params });
        if (url === '/emails') {
          const search = String(config?.params?.search ?? '');
          const filtered = emails.filter(
            (email) => typeof email?.name === 'string' && email.name.includes(search),
          );
          return { data: { total: filtered.length, emails: filtered } };
        }
        return { data: {} };
      },
      async post(url, body) {
        calls.post.push({ url, body });
        if (onPost) return onPost(url, body, emails);
        const created = {
          id: emails.length + 100,
          name: body.name,
          subject: body.subject,
          emailType: body.emailType,
          isPublished: body.isPublished === '1',
          customHtml: body.customHtml,
          plainText: body.plainText,
        };
        emails.push(created);
        return { data: { email: created } };
      },
    },
  };
  return { client, calls, emails };
}

function serverError(status = 500, message = 'Looks like I encountered an error (error #500)') {
  const error = new Error(message);
  error.response = { status, data: { errors: [{ message }] } };
  error.isAxiosError = true;
  return error;
}

async function expectContractError(run, contractCode) {
  const error = await run().then(
    () => {
      throw new Error('expected the call to reject');
    },
    (err) => err,
  );
  assert.ok(error instanceof MauticContractError, `expected MauticContractError, got ${error}`);
  assert.equal(error.contractCode, contractCode);
  return error;
}

test('isPublished:false is sent to the provider as the string "0"', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_email_template(client, {
    name: 'TEST draft',
    subject: 'TEST subject',
    emailType: 'template',
    isPublished: false,
    customHtml: HTML,
    plainText: PLAIN,
  });
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].url, '/emails/new');
  assert.equal(typeof calls.post[0].body.isPublished, 'string');
  assert.equal(calls.post[0].body.isPublished, '0');
});

test('isPublished:true is sent to the provider as the string "1"', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_email_template(client, {
    name: 'TEST published',
    subject: 'TEST subject',
    isPublished: true,
  });
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].body.isPublished, '1');
});

test('missing isPublished creates a draft and never publishes silently', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_email_template(client, { name: 'TEST default', subject: 'TEST subject' });
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].body.isPublished, '0');
});

test('raw HTML, plain text and Mautic personalization tokens are forwarded verbatim', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_email_template(client, {
    name: 'MCP CANARY — Żar i Szlif — NIE WYSYŁAĆ',
    subject: '[TEST — NIE WYSYŁAĆ] Żar i Szlif',
    emailType: 'template',
    isPublished: false,
    customHtml: HTML,
    plainText: PLAIN,
  });
  const body = calls.post[0].body;
  assert.equal(body.customHtml, HTML);
  assert.equal(body.plainText, PLAIN);
  assert.equal(body.name, 'MCP CANARY — Żar i Szlif — NIE WYSYŁAĆ');
  assert.equal(body.subject, '[TEST — NIE WYSYŁAĆ] Żar i Szlif');
  assert.ok(body.customHtml.includes('{{contact.firstname}}'));
  assert.ok(body.customHtml.includes('{contactfield=company}'));
  assert.ok(body.customHtml.includes('{% if lead.is_customer %}'));
});

test('emailType defaults to template and accepts the Mautic 7 enum', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_email_template(client, { name: 'A', subject: 'B' });
  assert.equal(calls.post[0].body.emailType, 'template');

  const second = createFakeClient();
  await toolHandlers.create_email_template(second.client, {
    name: 'A',
    subject: 'B',
    emailType: 'list',
  });
  assert.equal(second.calls.post[0].body.emailType, 'list');
});

test('an invalid emailType fails before the provider POST', async () => {
  const { client, calls } = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_email_template(client, {
        name: 'A',
        subject: 'B',
        emailType: 'newsletter',
      }),
    'invalid_email_type',
  );
  assert.equal(calls.post.length, 0);
});

test('a non-boolean isPublished fails before the provider POST', async () => {
  for (const value of ['0', '1', 0, 1, 'true', {}, []]) {
    const { client, calls } = createFakeClient();
    await expectContractError(
      () =>
        toolHandlers.create_email_template(client, {
          name: 'A',
          subject: 'B',
          isPublished: value,
        }),
      'invalid_is_published_type',
    );
    assert.equal(calls.post.length, 0, `isPublished ${JSON.stringify(value)} must not reach the provider`);
  }
});

test('recipient, campaign and other unsupported fields fail before the provider POST', async () => {
  for (const field of ['recipients', 'campaign', 'segmentId', 'sendAt', 'isPublishedAt']) {
    const { client, calls } = createFakeClient();
    await expectContractError(
      () =>
        toolHandlers.create_email_template(client, {
          name: 'A',
          subject: 'B',
          [field]: 'x',
        }),
      'unsupported_field',
    );
    assert.equal(calls.post.length, 0, `${field} must not reach the provider`);
  }
});

test('missing or empty name/subject fail before the provider POST', async () => {
  const missing = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_email_template(missing.client, { subject: 'B' }),
    'invalid_field_type',
  );
  assert.equal(missing.calls.post.length, 0);

  const empty = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_email_template(empty.client, { name: '   ', subject: 'B' }),
    'empty_field',
  );
  assert.equal(empty.calls.post.length, 0);

  const wrongType = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_email_template(wrongType.client, { name: 'A', subject: 42 }),
    'invalid_field_type',
  );
  assert.equal(wrongType.calls.post.length, 0);
});

test('a provider 500 is surfaced clearly and never reported as a created template', async () => {
  const { client, calls } = createFakeClient({ onPost: () => { throw serverError(); } });
  const error = await expectContractError(
    () =>
      toolHandlers.create_email_template(client, {
        name: 'TEST 500',
        subject: 'TEST subject',
        isPublished: false,
      }),
    'mautic_server_error',
  );
  assert.match(error.message, /Mautic API Error 500/);
  assert.match(error.message, /nothing was created/);
  assert.equal(calls.post.length, 1);
});

test('an ambiguous 500 is reconciled by the exact test-only name without a second write', async () => {
  const emails = [];
  const { client, calls } = createFakeClient({
    emails,
    onPost: (url, body, list) => {
      // The provider created the template but the response never reached us.
      list.push({ id: 7, name: body.name, subject: body.subject, emailType: body.emailType });
      throw serverError();
    },
  });
  const result = await toolHandlers.create_email_template(client, {
    name: 'MCP CANARY — TEST',
    subject: 'TEST subject',
    isPublished: false,
  });
  assert.equal(calls.post.length, 1, 'no blind retry');
  assert.match(result.content[0].text, /reconciled by exact name/);
});

test('create is idempotent: an existing exact name is reused and nothing is written', async () => {
  const emails = [{ id: 11, name: 'MCP CANARY — TEST', subject: 'older subject' }];
  const { client, calls } = createFakeClient({ emails });
  const result = await toolHandlers.create_email_template(client, {
    name: 'MCP CANARY — TEST',
    subject: 'TEST subject',
    isPublished: false,
  });
  assert.equal(calls.post.length, 0, 'no duplicate template may be created');
  assert.match(result.content[0].text, /already exists/);
});

test('a different name is not treated as an existing template', async () => {
  const emails = [{ id: 12, name: 'MCP CANARY — TEST (old)', subject: 'older subject' }];
  const { client, calls } = createFakeClient({ emails });
  await toolHandlers.create_email_template(client, {
    name: 'MCP CANARY — TEST',
    subject: 'TEST subject',
    isPublished: false,
  });
  assert.equal(calls.post.length, 1);
});

test('ambiguous duplicates with the same name are refused instead of adding one more', async () => {
  const emails = [
    { id: 13, name: 'MCP CANARY — TEST', subject: 'a' },
    { id: 14, name: 'MCP CANARY — TEST', subject: 'b' },
  ];
  const { client, calls } = createFakeClient({ emails });
  await expectContractError(
    () =>
      toolHandlers.create_email_template(client, {
        name: 'MCP CANARY — TEST',
        subject: 'TEST subject',
        isPublished: false,
      }),
    'ambiguous_existing_template',
  );
  assert.equal(calls.post.length, 0);
});

test('the MCP schema keeps isPublished ergonomic (boolean) and unchanged for callers', () => {
  const definition = toolDefinitions.find((tool) => tool.name === 'create_email_template');
  assert.ok(definition, 'create_email_template must be exposed');
  assert.equal(definition.inputSchema.properties.isPublished.type, 'boolean');
  assert.deepEqual(definition.inputSchema.required, ['name', 'subject']);
  assert.deepEqual(definition.inputSchema.properties.emailType.enum, ['template', 'list']);
});

test('the tool surface still exposes tag, contact-tag and campaign automation tools', () => {
  const names = new Set(allToolDefinitions.map((tool) => tool.name));
  for (const name of [
    'create_email_template',
    'list_emails',
    'get_email',
    'create_tag',
    'add_contact_tags',
    'create_campaign_with_automation',
    'list_tags',
    'list_segments',
    'list_campaigns',
  ]) {
    assert.ok(names.has(name), `missing tool: ${name}`);
  }
  const createTag = allToolDefinitions.find((tool) => tool.name === 'create_tag');
  assert.ok(createTag.inputSchema.properties.tag, 'create_tag must declare its tag field');
  const campaign = allToolDefinitions.find((tool) => tool.name === 'create_campaign_with_automation');
  assert.ok(campaign.inputSchema.properties.name, 'campaign automation must declare its name field');
});
