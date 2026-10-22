import assert from 'node:assert/strict';
import test from 'node:test';

import { toolDefinitions, toolHandlers } from '../build/tools/campaigns.js';
import { toolHandlers as businessHandlers } from '../build/tools/business.js';
import { allToolDefinitions } from '../build/tools/index.js';
import { MauticContractError } from '../build/tools/mautic-contract.js';

/**
 * Contract tests for the Mautic 7 campaign + tag write paths (KOMAA-1102).
 *
 * The fake MauticApiClient captures the wire body so we can assert what the
 * provider actually receives. Two defects are covered here:
 *  - `isPublished`/`allowRestart` must travel as the Mautic 7 wire string
 *    "0"/"1" (a JSON boolean produced HTTP 500, not 400);
 *  - a campaign must never be published by default and never be published
 *    together with an audience or a publish window.
 */

function createFakeClient({ campaigns = [], tags = [], onPost } = {}) {
  const calls = { get: [], post: [] };
  const client = {
    v1: {
      async get(url, config) {
        calls.get.push({ url, params: config?.params });
        if (url === '/campaigns') {
          const search = String(config?.params?.search ?? '');
          const filtered = campaigns.filter(
            (campaign) => typeof campaign?.name === 'string' && campaign.name.includes(search),
          );
          return { data: { total: filtered.length, campaigns: filtered } };
        }
        if (url === '/tags') {
          const search = String(config?.params?.search ?? '');
          const filtered = tags.filter(
            (tag) => typeof tag?.tag === 'string' && tag.tag.includes(search),
          );
          return { data: { total: filtered.length, tags: filtered } };
        }
        return { data: {} };
      },
      async post(url, body) {
        calls.post.push({ url, body });
        if (onPost) return onPost(url, body, { campaigns, tags });
        if (url === '/campaigns/new') {
          const created = { id: campaigns.length + 100, ...body };
          campaigns.push(created);
          return { data: { campaign: created } };
        }
        if (url === '/tags/new') {
          const created = { id: tags.length + 100, tag: body.tag };
          tags.push(created);
          return { data: { tag: created } };
        }
        return { data: {} };
      },
    },
  };
  return { client, calls, campaigns, tags };
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

/* -------------------------------------------------------------------------- */
/* create_campaign                                                             */
/* -------------------------------------------------------------------------- */

test('create_campaign defaults to an unpublished campaign ("0") and never publishes silently', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_campaign(client, { name: 'TEST campaign' });
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].url, '/campaigns/new');
  assert.equal(typeof calls.post[0].body.isPublished, 'string');
  assert.equal(calls.post[0].body.isPublished, '0');
});

test('create_campaign maps explicit false/true to the wire strings "0"/"1"', async () => {
  const draft = createFakeClient();
  await toolHandlers.create_campaign(draft.client, { name: 'A', isPublished: false });
  assert.equal(draft.calls.post[0].body.isPublished, '0');

  const published = createFakeClient();
  await toolHandlers.create_campaign(published.client, { name: 'B', isPublished: true });
  assert.equal(published.calls.post[0].body.isPublished, '1');
  assert.equal(typeof published.calls.post[0].body.isPublished, 'string');
});

test('create_campaign rejects a non-boolean isPublished before the provider POST', async () => {
  for (const value of ['0', '1', 0, 1, 'true', {}, []]) {
    const { client, calls } = createFakeClient();
    await expectContractError(
      () => toolHandlers.create_campaign(client, { name: 'A', isPublished: value }),
      'invalid_is_published_type',
    );
    assert.equal(calls.post.length, 0, `isPublished ${JSON.stringify(value)} must not reach the provider`);
  }
});

test('create_campaign rejects unknown fields instead of forwarding them verbatim', async () => {
  for (const field of ['segments', 'forms', 'events', 'isPublishedAt', 'lists']) {
    const { client, calls } = createFakeClient();
    await expectContractError(
      () => toolHandlers.create_campaign(client, { name: 'A', [field]: 'x' }),
      'unsupported_field',
    );
    assert.equal(calls.post.length, 0, `${field} must not reach the provider`);
  }
});

test('create_campaign requires a non-empty name and rejects a malformed publish window', async () => {
  const missing = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_campaign(missing.client, { description: 'x' }),
    'invalid_field_type',
  );
  assert.equal(missing.calls.post.length, 0);

  const empty = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_campaign(empty.client, { name: '  ' }),
    'empty_field',
  );
  assert.equal(empty.calls.post.length, 0);

  const badDate = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_campaign(badDate.client, { name: 'A', publishUp: '2026-10-20' }),
    'invalid_publish_date',
  );
  assert.equal(badDate.calls.post.length, 0);
});

test('create_campaign refuses a published campaign with a publish window (no silent activation)', async () => {
  const { client, calls } = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign(client, {
        name: 'A',
        isPublished: true,
        publishUp: '2026-10-20 08:00:00',
      }),
    'unsafe_published_schedule',
  );
  assert.equal(calls.post.length, 0, 'a scheduled published campaign must never be created');
});

/* -------------------------------------------------------------------------- */
/* create_campaign_with_automation                                             */
/* -------------------------------------------------------------------------- */

test('create_campaign_with_automation defaults to unpublished and allowRestart off', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_campaign_with_automation(client, { name: 'TEST sequence' });
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].url, '/campaigns/new');
  assert.equal(calls.post[0].body.isPublished, '0');
  assert.equal(calls.post[0].body.allowRestart, '0');
});

test('create_campaign_with_automation maps isPublished and allowRestart to wire strings', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_campaign_with_automation(client, {
    name: 'A',
    isPublished: true,
    allowRestart: true,
  });
  assert.equal(calls.post[0].body.isPublished, '1');
  assert.equal(calls.post[0].body.allowRestart, '1');
  assert.equal(typeof calls.post[0].body.allowRestart, 'string');
});

test('create_campaign_with_automation accepts the form-bound allowRestart strings "0"/"1"', async () => {
  for (const [value, expected] of [
    ['0', '0'],
    ['1', '1'],
  ]) {
    const { client, calls } = createFakeClient();
    await toolHandlers.create_campaign_with_automation(client, { name: 'A', allowRestart: value });
    assert.equal(calls.post[0].body.allowRestart, expected);
  }
});

test('create_campaign_with_automation rejects an invalid allowRestart before the provider POST', async () => {
  for (const value of ['yes', 2, {}, []]) {
    const { client, calls } = createFakeClient();
    await expectContractError(
      () => toolHandlers.create_campaign_with_automation(client, { name: 'A', allowRestart: value }),
      'invalid_allow_restart_type',
    );
    assert.equal(calls.post.length, 0, `allowRestart ${JSON.stringify(value)} must not reach the provider`);
  }
});

test('create_campaign_with_automation keeps the event sequence order and delay configuration intact', async () => {
  const { client, calls } = createFakeClient();
  const events = [
    {
      id: 'new1',
      name: 'Wait 1 hour',
      type: 'campaign.delay',
      eventType: 'action',
      order: 1,
      triggerMode: 'interval',
      triggerInterval: 1,
      triggerIntervalUnit: 'h',
      properties: { amount: 1, unit: 'H' },
    },
    {
      id: 'new2',
      name: 'Send welcome email',
      type: 'email.send',
      eventType: 'action',
      order: 2,
      triggerMode: 'immediate',
      properties: { email: 12 },
    },
  ];
  await toolHandlers.create_campaign_with_automation(client, { name: 'A', events });
  const body = calls.post[0].body;
  assert.equal(body.isPublished, '0');
  assert.equal(body.events.length, 2);
  assert.equal(body.events[0].id, 'new1');
  assert.equal(body.events[0].triggerInterval, 1);
  assert.equal(body.events[0].triggerIntervalUnit, 'h');
  assert.equal(body.events[1].id, 'new2');
  assert.deepEqual(body.events[1].properties, { email: 12 });
});

test('create_campaign_with_automation rejects duplicate event order before the provider POST', async () => {
  const { client, calls } = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(client, {
        name: 'A',
        events: [
          { name: 'one', order: 1 },
          { name: 'two', order: 1 },
        ],
      }),
    'duplicate_event_order',
  );
  assert.equal(calls.post.length, 0);
});

test('create_campaign_with_automation rejects events that are not in ascending execution order', async () => {
  const { client, calls } = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(client, {
        name: 'A',
        events: [
          { name: 'second', order: 2 },
          { name: 'first', order: 1 },
        ],
      }),
    'invalid_event_order',
  );
  assert.equal(calls.post.length, 0);
});

test('create_campaign_with_automation rejects a missing or invalid event order', async () => {
  const missing = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_campaign_with_automation(missing.client, { name: 'A', events: [{ name: 'x' }] }),
    'invalid_event_order',
  );
  assert.equal(missing.calls.post.length, 0);

  const negative = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(negative.client, {
        name: 'A',
        events: [{ name: 'x', order: -1 }],
      }),
    'invalid_event_order',
  );
  assert.equal(negative.calls.post.length, 0);
});

test('create_campaign_with_automation requires a delay value and a valid unit for an interval trigger', async () => {
  const noInterval = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(noInterval.client, {
        name: 'A',
        events: [{ name: 'wait', order: 1, triggerMode: 'interval' }],
      }),
    'invalid_event_interval',
  );
  assert.equal(noInterval.calls.post.length, 0);

  const badUnit = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(badUnit.client, {
        name: 'A',
        events: [
          { name: 'wait', order: 1, triggerMode: 'interval', triggerInterval: 5, triggerIntervalUnit: 'w' },
        ],
      }),
    'invalid_event_interval',
  );
  assert.equal(badUnit.calls.post.length, 0);

  const zeroInterval = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(zeroInterval.client, {
        name: 'A',
        events: [
          { name: 'wait', order: 1, triggerMode: 'interval', triggerInterval: 0, triggerIntervalUnit: 'h' },
        ],
      }),
    'invalid_event_interval',
  );
  assert.equal(zeroInterval.calls.post.length, 0);
});

test('create_campaign_with_automation rejects a delay on an immediate trigger (silently ignored delay)', async () => {
  const { client, calls } = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(client, {
        name: 'A',
        events: [
          { name: 'x', order: 1, triggerMode: 'immediate', triggerInterval: 3, triggerIntervalUnit: 'h' },
        ],
      }),
    'invalid_event_interval',
  );
  assert.equal(calls.post.length, 0);
});

test('create_campaign_with_automation rejects unknown event fields and invalid event enums', async () => {
  const unknown = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(unknown.client, {
        name: 'A',
        events: [{ name: 'x', order: 1, sendImmediately: true }],
      }),
    'unsupported_field',
  );
  assert.equal(unknown.calls.post.length, 0);

  const badType = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(badType.client, {
        name: 'A',
        events: [{ name: 'x', order: 1, eventType: 'sideways' }],
      }),
    'invalid_event_type',
  );
  assert.equal(badType.calls.post.length, 0);
});

test('create_campaign_with_automation validates the audience IDs it forwards', async () => {
  const { client, calls } = createFakeClient();
  await toolHandlers.create_campaign_with_automation(client, { name: 'A', segments: [3, 7] });
  assert.deepEqual(calls.post[0].body.lists, [{ id: 3 }, { id: 7 }]);

  const bad = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_campaign_with_automation(bad.client, { name: 'A', segments: ['3'] }),
    'invalid_id_list',
  );
  assert.equal(bad.calls.post.length, 0);

  const duplicate = createFakeClient();
  await expectContractError(
    () => toolHandlers.create_campaign_with_automation(duplicate.client, { name: 'A', forms: [1, 1] }),
    'duplicate_id',
  );
  assert.equal(duplicate.calls.post.length, 0);
});

test('create_campaign_with_automation refuses a published campaign with an attached audience', async () => {
  const { client, calls } = createFakeClient();
  await expectContractError(
    () =>
      toolHandlers.create_campaign_with_automation(client, {
        name: 'A',
        isPublished: true,
        segments: [3],
      }),
    'unsafe_published_audience',
  );
  assert.equal(calls.post.length, 0, 'a published campaign with an audience must never be created');
});

test('create_campaign is idempotent: an existing exact name is reused and nothing is written', async () => {
  const campaigns = [{ id: 21, name: 'TEST sequence', isPublished: false }];
  const { client, calls } = createFakeClient({ campaigns });
  const result = await toolHandlers.create_campaign_with_automation(client, { name: 'TEST sequence' });
  assert.equal(calls.post.length, 0, 'no duplicate campaign may be created');
  assert.match(result.content[0].text, /already exists/);
});

test('ambiguous campaigns with the same name are refused instead of adding one more', async () => {
  const campaigns = [
    { id: 31, name: 'TEST sequence' },
    { id: 32, name: 'TEST sequence' },
  ];
  const { client, calls } = createFakeClient({ campaigns });
  await expectContractError(
    () => toolHandlers.create_campaign(client, { name: 'TEST sequence' }),
    'ambiguous_existing_campaign',
  );
  assert.equal(calls.post.length, 0);
});

test('an ambiguous campaign 500 is reconciled by the exact name without a second write', async () => {
  const campaigns = [];
  const { client, calls } = createFakeClient({
    campaigns,
    onPost: (url, body, state) => {
      // The provider created the campaign but the response never reached us.
      state.campaigns.push({ id: 41, name: body.name, isPublished: body.isPublished === '1' });
      throw serverError();
    },
  });
  const result = await toolHandlers.create_campaign_with_automation(client, { name: 'TEST sequence' });
  assert.equal(calls.post.length, 1, 'no blind retry');
  assert.match(result.content[0].text, /reconciled by exact name/);
});

test('a campaign 500 that created nothing is surfaced as a typed server error', async () => {
  const { client, calls } = createFakeClient({ onPost: () => { throw serverError(); } });
  const error = await expectContractError(
    () => toolHandlers.create_campaign(client, { name: 'TEST sequence' }),
    'mautic_server_error',
  );
  assert.match(error.message, /Mautic API Error 500/);
  assert.match(error.message, /nothing was created/);
  assert.equal(calls.post.length, 1);
});

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

test('create_tag posts the Mautic tag payload and is idempotent on the exact tag name', async () => {
  const created = createFakeClient();
  await businessHandlers.create_tag(created.client, { tag: 'MCP-CANARY-TEST-20261020' });
  assert.equal(created.calls.post.length, 1);
  assert.equal(created.calls.post[0].url, '/tags/new');
  assert.deepEqual(created.calls.post[0].body, { tag: 'MCP-CANARY-TEST-20261020' });

  const existing = [{ id: 51, tag: 'MCP-CANARY-TEST-20261020' }];
  const reused = createFakeClient({ tags: existing });
  const result = await businessHandlers.create_tag(reused.client, { tag: 'MCP-CANARY-TEST-20261020' });
  assert.equal(reused.calls.post.length, 0, 'no duplicate tag may be created');
  assert.match(result.content[0].text, /already exists/);
});

test('create_tag rejects an empty or non-string tag before the provider POST', async () => {
  const empty = createFakeClient();
  await expectContractError(() => businessHandlers.create_tag(empty.client, { tag: '   ' }), 'empty_field');
  assert.equal(empty.calls.post.length, 0);

  const wrongType = createFakeClient();
  await expectContractError(() => businessHandlers.create_tag(wrongType.client, { tag: 42 }), 'invalid_field_type');
  assert.equal(wrongType.calls.post.length, 0);
});

test('an ambiguous tag 500 is reconciled by the exact name without a second write', async () => {
  const tags = [];
  const { client, calls } = createFakeClient({
    tags,
    onPost: (url, body, state) => {
      state.tags.push({ id: 61, tag: body.tag });
      throw serverError();
    },
  });
  const result = await businessHandlers.create_tag(client, { tag: 'MCP-CANARY-TEST-20261020' });
  assert.equal(calls.post.length, 1, 'no blind retry');
  assert.match(result.content[0].text, /reconciled by exact name/);
});

test('add_contact_tags validates the contact ID and the tag list before the provider POST', async () => {
  const badId = createFakeClient();
  await expectContractError(
    () => businessHandlers.add_contact_tags(badId.client, { contactId: 'x', tags: ['a'] }),
    'invalid_id',
  );
  assert.equal(badId.calls.post.length, 0);

  const badTags = createFakeClient();
  await expectContractError(
    () => businessHandlers.add_contact_tags(badTags.client, { contactId: 5, tags: [] }),
    'invalid_tag_list',
  );
  assert.equal(badTags.calls.post.length, 0);
});

/* -------------------------------------------------------------------------- */
/* Schema and tool-surface guarantees                                          */
/* -------------------------------------------------------------------------- */

test('the campaign MCP schema stays ergonomic (boolean) for callers', () => {
  const create = toolDefinitions.find((tool) => tool.name === 'create_campaign');
  assert.ok(create, 'create_campaign must be exposed');
  assert.equal(create.inputSchema.properties.isPublished.type, 'boolean');
  assert.deepEqual(create.required, undefined);
  assert.deepEqual(create.inputSchema.required, ['name']);

  const automation = toolDefinitions.find((tool) => tool.name === 'create_campaign_with_automation');
  assert.ok(automation, 'create_campaign_with_automation must be exposed');
  assert.equal(automation.inputSchema.properties.isPublished.type, 'boolean');
  assert.equal(automation.inputSchema.properties.allowRestart.type, 'boolean');
  assert.deepEqual(automation.inputSchema.required, ['name']);
});

test('mutating tools are not annotated as read-only', () => {
  const byName = new Map(allToolDefinitions.map((tool) => [tool.name, tool]));
  for (const name of [
    'create_campaign',
    'create_campaign_with_automation',
    'execute_campaign',
    'add_contact_to_campaign',
    'create_tag',
    'add_contact_tags',
    'create_email_template',
    'send_email',
    'send_email_to_segment',
  ]) {
    const tool = byName.get(name);
    assert.ok(tool, `missing tool: ${name}`);
    assert.notEqual(
      tool.annotations?.readOnlyHint,
      true,
      `${name} mutates the provider and must not be annotated read-only`,
    );
  }

  for (const name of ['list_campaigns', 'get_campaign', 'list_tags', 'list_emails', 'get_email']) {
    const tool = byName.get(name);
    assert.ok(tool, `missing tool: ${name}`);
    assert.equal(tool.annotations?.readOnlyHint, true, `${name} is read-only and must say so`);
  }
});
