'use client';

import { createContext, useContext } from 'react';

interface PanelContextValue {
  artifactOpen: boolean;
  setArtifactOpen: (open: boolean) => void;
}

export const PanelContext = createContext<PanelContextValue>({
  artifactOpen: true,
  setArtifactOpen: () => {},
});

export function usePanelContext() {
  return useContext(PanelContext);
}
