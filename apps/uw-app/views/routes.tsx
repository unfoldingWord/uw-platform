import { Hono, type Context, type Next } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { agentQueuesScreen } from './screens/agent-queues.tsx';
import { agentsScreen } from './screens/agents.tsx';
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
import { savePage } from './parts/page-save.tsx';
import { changeRoutineForm, newRoutine } from './parts/routine-new.tsx';
import { runScreen } from './screens/run.tsx';
import { runsScreen } from './screens/runs.tsx';
import { oldWaitingAddress, waitingScreen } from './screens/waiting.tsx';

const sameOrigin = csrf();

async function formGuard(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  try {
    return await sameOrigin(c, next);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return refuse(c, 'not_permitted');
    throw error;
  }
}

function formRoutes(routes: Hono<AppEnv>): void {
  routes.use('/harnesses/:harnessId/agents/routines', formGuard);
  routes.post('/harnesses/:harnessId/agents/routines', newRoutine);
  routes.use('/harnesses/:harnessId/agents/routines/:routineId', formGuard);
  routes.post('/harnesses/:harnessId/agents/routines/:routineId', changeRoutineForm);
  routes.use('/pages/:pageId', formGuard);
  routes.post('/pages/:pageId', savePage);
  routes.use('/harnesses/:harnessId/agents/new', formGuard);
  routes.post('/harnesses/:harnessId/agents/new', addAgent);
  routes.use('/personas/:pageId/toolset', formGuard);
  routes.post('/personas/:pageId/toolset', saveToolset);
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
  routes.get('/harnesses/:harnessId/agents', agentsScreen);
  routes.get('/harnesses/:harnessId/agents/new', newAgentScreen);
  routes.get('/gates', oldWaitingAddress);
  routes.get('/harnesses/:harnessId/gates/:itemId', gateScreen);
  routes.get('/harnesses/:harnessId/items/:itemId', playScreen);
  routes.get('/personas/:pageId', personaScreen);
  formRoutes(routes);
  return routes;
}
