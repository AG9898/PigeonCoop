// First-run detection and demo workflow seeding.
//
// On mount, checks whether the canonical demo workflow exists in the database.
// If not, imports it — making it immediately available in the Library.
//
// Returns { isFirstRun, seeding } so the App shell can route the user
// to the Library view on first launch.

import { useEffect, useState } from "react";
import { ipc } from "../types/ipc";
import { DEMO_WORKFLOW_ID, demWorkflowJson } from "../data/demo-workflow";

interface FirstRunState {
  /** True if this is the first launch (demo workflow was not yet in the DB). */
  isFirstRun: boolean;
  /** True while the seed operation is in progress. */
  seeding: boolean;
}

export function useFirstRun(): FirstRunState {
  const [state, setState] = useState<FirstRunState>({
    isFirstRun: false,
    seeding: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function seed() {
      try {
        const existing = await ipc.getWorkflow({ id: DEMO_WORKFLOW_ID });
        if (cancelled) return;

        if (existing) {
          // Demo already present — not first run.
          setState({ isFirstRun: false, seeding: false });
          return;
        }

        // First run: seed the demo workflow.
        await ipc.importWorkflow({ json: demWorkflowJson() });
        if (cancelled) return;
        setState({ isFirstRun: true, seeding: false });
      } catch {
        // If the backend is unavailable (e.g. in tests), silently skip.
        if (!cancelled) {
          setState({ isFirstRun: false, seeding: false });
        }
      }
    }

    seed();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
