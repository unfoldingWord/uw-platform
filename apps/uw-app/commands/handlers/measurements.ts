import { commandHandler, fromKernel } from '../handler.ts';

export const recordMeasurementCommand = commandHandler({
  name: 'record_measurement',
  action: 'write',
  agents: 'refused',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.measurements.record(context.caller, {
        itemId: body.itemId,
        source: body.source,
        name: body.name,
        value: body.value,
        asOf: body.asOf,
      }),
    ),
});
