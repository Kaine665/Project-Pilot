import {
  getAgentsWorkspaceUiPath,
  readJsonFile,
  modifyJsonFile,
  ensureDataDirV2Migrated,
} from './file-store';
import {
  AGENTS_WORKSPACE_UI_VERSION,
  agentsWorkspaceStorageKey,
  type AgentsWorkspaceProjectPersist,
} from './agents-workspace-ui-shared';

interface AgentsWorkspaceUiFile {
  version: typeof AGENTS_WORKSPACE_UI_VERSION;
  byProject: Record<string, AgentsWorkspaceProjectPersist>;
}

const EMPTY: AgentsWorkspaceUiFile = {
  version: AGENTS_WORKSPACE_UI_VERSION,
  byProject: {},
};

export type { AgentsWorkspaceProjectPersist, AgentsWorkspaceActivePersist } from './agents-workspace-ui-shared';

export async function readAgentsWorkspaceProjectState(
  projectKey: string | null,
): Promise<AgentsWorkspaceProjectPersist | null> {
  await ensureDataDirV2Migrated();
  const data = await readJsonFile<AgentsWorkspaceUiFile>(getAgentsWorkspaceUiPath(), EMPTY);
  const k = agentsWorkspaceStorageKey(projectKey);
  return data.byProject[k] ?? null;
}

export async function writeAgentsWorkspaceProjectState(
  projectKey: string | null,
  state: AgentsWorkspaceProjectPersist | null,
): Promise<void> {
  await ensureDataDirV2Migrated();
  await modifyJsonFile<AgentsWorkspaceUiFile>(getAgentsWorkspaceUiPath(), EMPTY, (data) => {
    const k = agentsWorkspaceStorageKey(projectKey);
    if (!state || state.tabs.length === 0) {
      delete data.byProject[k];
    } else {
      data.byProject[k] = state;
    }
    data.version = AGENTS_WORKSPACE_UI_VERSION;
    return data;
  });
}
