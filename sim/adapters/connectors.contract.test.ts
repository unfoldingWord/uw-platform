import { describeConnectorsContract } from '@uw/harness/port-contracts/connectors';
import { createSimConnectors } from './connectors.ts';

describeConnectorsContract('the recording sim connectors', async () => {
  const connectors = createSimConnectors();
  return {
    connectors,
    refuseNext: async (connector, reason) => connectors.refuseNext(connector, reason),
  };
});
