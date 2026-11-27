import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { formGuard } from '../http/form-guard.ts';
import { agentQueuesScreen } from './screens/agent-queues.tsx';
import { agentsScreen } from './screens/agents.tsx';
import { myAssistantScreen, startPairingForm } from './screens/assistant.tsx';
import { addAgent, newAgentScreen } from './screens/new-agent.tsx';
import { newWorkflowScreen } from './screens/new-workflow.tsx';
import { oldQueueAddress, queueScreen } from './screens/queue.tsx';
import { controlsScreen } from './screens/controls.tsx';
import { flowScreen } from './screens/flow.tsx';
import { gateScreen } from './screens/gate.tsx';
import { homeScreen } from './screens/home.tsx';
import { saveToolset } from './parts/toolset-save.tsx';
import { personaScreen } from './screens/persona.tsx';
import { playScreen } from './screens/play.tsx';
import { pageScreen } from './screens/page.tsx';
import { pageEditScreen } from './screens/page-edit.tsx';
import { savePage } from './parts/page-save.tsx';
import { changeRoutineForm, newRoutine } from './parts/routine-new.tsx';
import { runScreen } from './screens/run.tsx';
import { runsScreen } from './screens/runs.tsx';
import { oldWaitingAddress, waitingScreen } from './screens/waiting.tsx';

function formRoutes(routes: Hono<AppEnv>): void {
  routes.use('/harnesses/:harnessId/agents/routines', formGuard);
  routes.post('/harnesses/:harnessId/agents/routines', newRoutine);
  routes.use('/harnesses/:harnessId/agents/routines/:routineId', formGuard);
  routes.post('/harnesses/:harnessId/agents/routines/:routineId', changeRoutineForm);
  routes.use('/pages/:pageId/edit', formGuard);
  routes.post('/pages/:pageId/edit', savePage);
  routes.use('/harnesses/:harnessId/agents/new', formGuard);
  routes.post('/harnesses/:harnessId/agents/new', addAgent);
  routes.use('/personas/:pageId/toolset', formGuard);
  routes.post('/personas/:pageId/toolset', saveToolset);
  routes.use('/assistant/pairing', formGuard);
  routes.post('/assistant/pairing', startPairingForm);
}

export function viewRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', homeScreen);
  routes.get('/agent-queues', agentQueuesScreen);
  routes.get('/agent-queues/new', newWorkflowScreen);
  routes.get('/harnesses/:harnessId', flowScreen);
  routes.get('/harnesses/:harnessId/queue', queueScreen);
  routes.get('/harnesses/:harnessId/board', oldQueueAddress);
  routes.get('/harnesses/:harnessId/waiting', waitingScreen);
  routes.get('/harnesses/:harnessId/runs', runsScreen);
  routes.get('/harnesses/:harnessId/runs/:runId', runScreen);
  routes.get('/harnesses/:harnessId/controls', controlsScreen);
  routes.get('/pages/:pageId', pageScreen);
  routes.get('/pages/:pageId/edit', pageEditScreen);
  routes.get('/harnesses/:harnessId/agents', agentsScreen);
  routes.get('/harnesses/:harnessId/agents/new', newAgentScreen);
  routes.get('/gates', oldWaitingAddress);
  routes.get('/harnesses/:harnessId/gates/:itemId', gateScreen);
  routes.get('/harnesses/:harnessId/items/:itemId', playScreen);
  routes.get('/personas/:pageId', personaScreen);
  routes.get('/assistant', myAssistantScreen);
  formRoutes(routes);
  return routes;
}
