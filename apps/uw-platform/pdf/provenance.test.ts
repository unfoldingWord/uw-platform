import { describe, expect, it } from 'vitest';
import { principalSchema } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { canonicalJson, exporterOf, pageVersionHash, sha256Hex } from './provenance.ts';

const PERSON_ID = '5b0c3a4e-7d1f-4c55-9a43-2f1e8d6b7a10';

const snapshot = {
  pageId: '0f7e6d5c-4b3a-4291-8f0e-1d2c3b4a5968',
  version: 3,
  slug: 'security-guidelines',
  title: 'Security guidelines',
  frontmatter: { tags: ['security'], owner: 'ops' },
  bodyMd: '# Security\n\nLock the door.\n',
};

const agent = principalSchema.parse({
  identity: 'agent:reviewer',
  kind: 'agent',
  personId: null,
  email: null,
  grants: [],
  interactive: false,
});

describe('#198 the provenance of a printed export', () => {
  it('#198 writes canonical JSON with sorted keys at every depth and no whitespace', () => {
    const value = { b: 1, a: { d: [3, { z: true, y: null }], c: 'x' }, skipped: undefined };
    expect(canonicalJson(value)).toBe('{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('#198 hashes text and bytes to the published SHA-256 vectors in lowercase hex', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256Hex('abc')).toBe(abc);
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(abc);
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('#198 the hash of a page version', () => {
  it('#198 hashes a page version the same way every time, from the snapshot fields alone', async () => {
    const first = await pageVersionHash(snapshot);
    const reordered = { ...snapshot, frontmatter: { owner: 'ops', tags: ['security'] } };
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await pageVersionHash(reordered)).toBe(first);
    expect(await pageVersionHash({ ...snapshot, savedBy: 'human:x' } as typeof snapshot)).toBe(
      first,
    );
    expect(first).toBe(
      await sha256Hex(
        canonicalJson({
          bodyMd: snapshot.bodyMd,
          frontmatter: snapshot.frontmatter,
          pageId: snapshot.pageId,
          slug: snapshot.slug,
          title: snapshot.title,
          version: snapshot.version,
        }),
      ),
    );
  });

  it('#198 changes the page version hash when the body, the title or the version changes', async () => {
    const first = await pageVersionHash(snapshot);
    expect(await pageVersionHash({ ...snapshot, bodyMd: `${snapshot.bodyMd} ` })).not.toBe(first);
    expect(await pageVersionHash({ ...snapshot, title: 'Other' })).not.toBe(first);
    expect(await pageVersionHash({ ...snapshot, version: 4 })).not.toBe(first);
  });

  it('#198 names a person exporter by email and an agent exporter by identity', () => {
    const person = personPrincipal({
      personId: PERSON_ID,
      email: 'reader@example.org',
      grants: [],
      interactive: true,
    });
    expect(exporterOf(person)).toBe('reader@example.org');
    expect(exporterOf(agent)).toBe('agent:reviewer');
  });
});
