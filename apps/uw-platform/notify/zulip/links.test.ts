import { describe, expect, it } from 'vitest';
import type { ZulipConfig } from './config.ts';
import { itemTopicUrl, zulipTopicUrl } from './links.ts';

const config: ZulipConfig = {
  site: 'https://chat.example',
  botEmail: 'bot@chat.example',
  apiKey: 'key',
  channels: new Map([['80-89', '80-89 Tech & SLR']]),
};

describe('the Zulip topic link', () => {
  it('encodes the channel and topic the way Zulip narrows them', () => {
    expect(
      zulipTopicUrl('https://chat.example', '80-89 Tech & SLR', 'software/uw-platform#42'),
    ).toBe(
      'https://chat.example/#narrow/channel/80-89.20Tech.20.26.20SLR/topic/software.2Fuw-platform.2342',
    );
  });

  it('links an item topic only when the configuration, the channel and the topic are known', () => {
    expect(itemTopicUrl(config, '80-89', 'software/a.b')).toBe(
      'https://chat.example/#narrow/channel/80-89.20Tech.20.26.20SLR/topic/software.2Fa.2Eb',
    );
    expect(itemTopicUrl(null, '80-89', 'software')).toBeNull();
    expect(itemTopicUrl(config, '10-19', 'software')).toBeNull();
    expect(itemTopicUrl(config, '80-89', null)).toBeNull();
  });
});
