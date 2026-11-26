import { describe, expect, it } from 'vitest';
import { commandBody } from './command-body.ts';
import { OUTCOME_TEXT } from './command-form.ts';

const requestId = 'f0000000-0000-4000-8000-000000000001';
const measureId = 'a0000000-0000-4000-8000-000000000001';

describe('ADR 0034 the measure controls send the person commands', () => {
  it.each(['run_measure_trial', 'run_measure_now'])(
    'builds %s from the page version',
    (command) => {
      expect(commandBody(command, { measureId, expectedVersion: '3' }, requestId)).toEqual({
        command,
        requestId,
        measureId,
        expectedVersion: 3,
      });
    },
  );

  it('activates a measure with no dashboards named', () => {
    expect(commandBody('activate_measure', { measureId, expectedVersion: '2' }, requestId)).toEqual(
      { command: 'activate_measure', requestId, measureId, expectedVersion: 2, dashboards: [] },
    );
  });

  it('activates a dashboard', () => {
    expect(
      commandBody(
        'activate_dashboard',
        { dashboardId: measureId, expectedVersion: '1' },
        requestId,
      ),
    ).toEqual({
      command: 'activate_dashboard',
      requestId,
      dashboardId: measureId,
      expectedVersion: 1,
    });
  });

  it('refuses a body without a version', () => {
    expect(commandBody('run_measure_trial', { measureId }, requestId)).toBeNull();
  });

  it('says what each control did', () => {
    for (const command of [
      'run_measure_trial',
      'activate_measure',
      'run_measure_now',
      'activate_dashboard',
    ]) {
      expect(OUTCOME_TEXT[command]).toMatch(/^[A-Z]/);
    }
  });
});

describe('ADR 0034 Activate makes the ticked dashboards active in the same step', () => {
  it('activates a measure with the dashboards the person ticked', () => {
    const card = 'd0000000-0000-4000-8000-000000000001';
    const board = 'd0000000-0000-4000-8000-000000000002';
    const given = {
      measureId,
      expectedVersion: '2',
      [`dashboard.${card}`]: card,
      [`dashboard.${board}`]: board,
    };
    expect(commandBody('activate_measure', given, requestId)).toEqual({
      command: 'activate_measure',
      requestId,
      measureId,
      expectedVersion: 2,
      dashboards: [card, board],
    });
  });
});
