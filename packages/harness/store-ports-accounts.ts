import type { AssistantAccountStatus } from '@uw/contracts';

export type AssistantAccountRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly name: string;
  readonly jdId: string | null;
  readonly status: AssistantAccountStatus;
  readonly disabledAt: Date | null;
  readonly deletedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
export type AssistantAccountsGateway = {
  readonly read: {
    byPerson(personId: string): Promise<AssistantAccountRow | null>;
    byHarness(harnessId: string): Promise<AssistantAccountRow | null>;
    nameHolder(name: string): Promise<string | null>;
    takenJdIds(): Promise<readonly string[]>;
    disabledBefore(before: Date, limit: number): Promise<readonly AssistantAccountRow[]>;
  };
  readonly write: {
    insert(row: AssistantAccountRow): Promise<void>;
    update(row: AssistantAccountRow, expectedVersion: number): Promise<boolean>;
  };
};
