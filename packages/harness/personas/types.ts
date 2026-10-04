import type { Harness, Identity, personaFrontmatterSchema, VerbDefinition } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { PageFacts, Ports } from '../ports.ts';

export type PersonaPorts = Pick<Ports, 'grants' | 'ids'>;

export type PersonaFrontmatter = ReturnType<typeof personaFrontmatterSchema.parse>;

export type Persona = {
  readonly page: PageFacts;
  readonly frontmatter: PersonaFrontmatter;
  readonly harness: Harness;
};

export type Activation = {
  readonly caller: Caller;
  readonly pageId: string;
  readonly expectedVersion: number;
  readonly harnessId: string;
  readonly at: Date;
  readonly registry: readonly VerbDefinition[];
};

export type ActivatedPersona = {
  readonly pageId: string;
  readonly persona: Identity;
  readonly harnessId: string;
  readonly version: number;
};
