// Root application shell. Handles top-level view routing.
// Views: Builder, LiveRun, Replay, Library. See ARCHITECTURE.md §10.
// Keyboard shortcuts: 1=Builder, 2=LiveRun, 3=Replay, 4=Library (DESIGN_SPEC §13).

import { useEffect, useState } from "react";
import { BuilderView } from "../views/BuilderView";
import { LibraryView } from "../views/LibraryView";
import { LiveRunView } from "../views/LiveRunView";
import { ReplayView } from "../views/ReplayView";
import { useFirstRun } from "../hooks/useFirstRun";

type View = "builder" | "liverun" | "replay" | "library";

const NAV_ITEMS: { id: View; label: string; shortcut: string }[] = [
  { id: "builder", label: "Builder", shortcut: "1" },
  { id: "liverun", label: "Live Run", shortcut: "2" },
  { id: "replay", label: "Replay", shortcut: "3" },
  { id: "library", label: "Library", shortcut: "4" },
];

export function App() {
  const [activeView, setActiveView] = useState<View>("builder");
  const [replayRunId, setReplayRunId] = useState<string | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const { isFirstRun, seeding } = useFirstRun();

  // On first run, navigate to the Library so the user sees the demo workflow.
  useEffect(() => {
    if (!seeding && isFirstRun) {
      setActiveView("library");
    }
  }, [seeding, isFirstRun]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "1": setActiveView("builder"); break;
        case "2": setActiveView("liverun"); break;
        case "3": setActiveView("replay"); break;
        case "4": setActiveView("library"); break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function openReplay(runId: string) {
    setReplayRunId(runId || null);
    setActiveView("replay");
  }

  function openLiveRun(runId: string) {
    setLiveRunId(runId || null);
    setActiveView("liverun");
  }

  function openBuilder(_workflowId?: string) {
    setActiveView("builder");
  }

  return (
    <div className="app">
      <nav className="app-nav">
        <span className="app-nav-brand">AGENT ARCADE</span>
        <div className="app-nav-items">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item${activeView === item.id ? " nav-item--active" : ""}`}
              onClick={() => setActiveView(item.id)}
            >
              {item.label}
              <kbd className="nav-shortcut">{item.shortcut}</kbd>
            </button>
          ))}
        </div>
      </nav>
      <main className="app-main">
        {activeView === "builder" && <BuilderView />}
        {activeView === "liverun" && <LiveRunView runId={liveRunId} />}
        {activeView === "replay" && <ReplayView runId={replayRunId} />}
        {activeView === "library" && (
          <LibraryView onOpenReplay={openReplay} onOpenBuilder={openBuilder} isFirstRun={isFirstRun} />
        )}
      </main>
    </div>
  );
}
