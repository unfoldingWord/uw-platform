import { PortNotWiredError } from '@uw/harness';

export class SandboxNotWiredError extends PortNotWiredError {
  readonly why = 'egress_unavailable';

  constructor() {
    super('modelEngine', 'work');
    this.message = 'modelEngine.work is not wired: egress_unavailable';
  }
}
