import { describeWorkspaceContract } from '@uw/harness/port-contracts/workspace';
import { createSimWorkspace } from './workspace.ts';

const personIds = [
  'c5000000-0000-4000-8000-000000000011',
  'c5000000-0000-4000-8000-000000000012',
  'c5000000-0000-4000-8000-000000000013',
];

describeWorkspaceContract('the recording sim workspace', async () => {
  const workspace = createSimWorkspace();
  let added = 0;
  return {
    workspace,
    outsider: 'someone@elsewhere.example',
    addPerson: async (email) => {
      const personId = personIds[added] ?? '';
      added += 1;
      workspace.addPerson(personId, email);
      return personId;
    },
    addEvent: async (personId, event) => workspace.addEvent(personId, event),
    events: async (personId) => workspace.events(personId),
    addressesReached: async () => workspace.addressesReached(),
  };
});
