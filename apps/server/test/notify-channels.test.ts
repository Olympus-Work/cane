import { describe, expect, it, vi } from 'vitest';
import { lineChannel, telegramChannel, type NotifyFetch } from '../src/notify/channels.js';

const LINE_TOKEN = 'line-token-fixture';
const LINE_USER = 'U-fixture-user';
const TG_TOKEN = '123456:tg-fixture-token';
const TG_CHAT = 'fixture-chat-id';

function reply(status: number, body: string) {
  return { status, text: async () => body };
}

function fakeFetch(impl: NotifyFetch): ReturnType<typeof vi.fn<NotifyFetch>> {
  return vi.fn<NotifyFetch>(impl);
}

describe('lineChannel', () => {
  it('sends a push message and reports success', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{}')));
    const channel = lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch);
    expect(channel.name).toBe('line');

    const result = await channel.send('hello');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${LINE_TOKEN}`);
    const body = JSON.parse(init.body);
    expect(body.to).toBe(LINE_USER);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ type: 'flex', altText: 'hello' });
  });

  it('reports a provider error and redacts the token', async () => {
    const fetch = fakeFetch(() =>
      Promise.resolve(reply(401, '{"message":"Authentication failed. Confirm that the access token in the authorization header is valid."}')),
    );
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith('HTTP 401: Authentication failed')).toBe(true);
      expect(result.error).not.toContain(LINE_TOKEN);
    }
  });

  it('redacts every secret a provider message echoes', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(400, `{"message":"bad token ${LINE_TOKEN} for ${LINE_USER}"}`)));
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(LINE_TOKEN);
      expect(result.error).not.toContain(LINE_USER);
      expect(result.error).toContain('***');
    }
  });

  it('resends as plain text when LINE rejects the Flex layout with HTTP 400', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{}')));
    fetch.mockImplementationOnce(() => Promise.resolve(reply(400, '{"message":"A message (messages[0]) in the request body is invalid"}')));

    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('[Login]', 'login_success');

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0]![1].body).messages[0].type).toBe('flex');
    expect(JSON.parse(fetch.mock.calls[1]![1].body).messages).toEqual([{ type: 'text', text: '[Login]' }]);
  });

  it('does not resend on errors other than HTTP 400', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(500, 'oops')));
    await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('[Login]');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a non-JSON error body as a bare status', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(500, 'boom')));
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'HTTP 500' });
  });

  it('cuts long text to 4000 characters, and altText to the LINE limit of 400', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{}')));
    await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('x'.repeat(6000));

    const sent = JSON.parse(fetch.mock.calls[0]![1].body) as {
      messages: Array<{ altText: string; contents: { header: { contents: Array<{ text: string }> } } }>;
    };
    expect(sent.messages[0]?.altText).toHaveLength(400);
    expect(sent.messages[0]?.contents.header.contents[0]?.text).toHaveLength(4000);
  });

  it('cuts a long provider message to at most 200 characters', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(401, JSON.stringify({ message: 'y '.repeat(250) }))));
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('hello');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveLength(200);
  });

  it('never throws when fetch rejects with a network error', async () => {
    const fetch = fakeFetch(() =>
      Promise.reject(Object.assign(new TypeError(`connect ECONNREFUSED https://api.line.me/v2/bot/${LINE_TOKEN}`), {})),
    );
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'network error (TypeError)' });
  });

  it('never throws when fetch throws synchronously', async () => {
    const fetch = fakeFetch(() => {
      throw new Error('sync');
    });
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'network error (Error)' });
  });

  it('aborts after the timeout and reports `timeout`', async () => {
    const fetch = vi.fn<NotifyFetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init.signal.aborted) {
          fail();
          return;
        }
        init.signal.addEventListener('abort', fail);
      }),
    );
    const started = Date.now();
    const result = await lineChannel({ channelToken: LINE_TOKEN, userId: LINE_USER }, fetch, 30).send('hello');
    const elapsed = Date.now() - started;

    expect(result).toEqual({ ok: false, error: 'timeout' });
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('telegramChannel', () => {
  it('sends a message and reports success', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{"ok":true}')));
    const channel = telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch);
    expect(channel.name).toBe('telegram');

    const result = await channel.send('hello');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ chat_id: TG_CHAT, text: '🟣 <b>hello</b>', parse_mode: 'HTML' });
  });

  it('reports a provider error with the description', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(400, '{"ok":false,"description":"Bad Request: chat not found"}')));
    const result = await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'HTTP 400: Bad Request: chat not found' });
  });

  it('resends as plain text without parse_mode when Telegram rejects the HTML with HTTP 400', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{"ok":true}')));
    fetch.mockImplementationOnce(() => Promise.resolve(reply(400, '{"ok":false,"description":"Bad Request: can\'t parse entities"}')));

    const result = await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('[Login]', 'login_success');

    expect(result).toEqual({ ok: true });
    expect(JSON.parse(fetch.mock.calls[0]![1].body).parse_mode).toBe('HTML');
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ chat_id: TG_CHAT, text: '[Login]' });
  });

  it('treats an HTTP 200 with ok !== true as a failure', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{"ok":false,"description":"Forbidden"}')));
    const result = await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'HTTP 200: Forbidden' });
  });

  it('treats an HTTP 200 with a non-JSON body as a failure', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, 'not json')));
    const result = await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'HTTP 200: unexpected response' });
  });

  it('redacts every secret a provider message echoes', async () => {
    const fetch = fakeFetch(() =>
      Promise.resolve(reply(400, `{"ok":false,"description":"bad bot ${TG_TOKEN} chat ${TG_CHAT}"}`)),
    );
    const result = await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('hello');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(TG_TOKEN);
      expect(result.error).not.toContain(TG_CHAT);
      expect(result.error).toContain('***');
    }
  });

  it('cuts long text to 4000 characters', async () => {
    const fetch = fakeFetch(() => Promise.resolve(reply(200, '{"ok":true}')));
    await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('x'.repeat(6000));

    const sent = JSON.parse(fetch.mock.calls[0]![1].body) as { text: string };
    expect(sent.text).toBe(`🟣 <b>${'x'.repeat(4000)}</b>`);
  });

  it('never throws when fetch rejects with a network error', async () => {
    const fetch = fakeFetch(() =>
      Promise.reject(Object.assign(new TypeError(`connect ECONNREFUSED https://api.telegram.org/bot${TG_TOKEN}/sendMessage`), {})),
    );
    const result = await telegramChannel({ botToken: TG_TOKEN, chatId: TG_CHAT }, fetch).send('hello');

    expect(result).toEqual({ ok: false, error: 'network error (TypeError)' });
  });
});
