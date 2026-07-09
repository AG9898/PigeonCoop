// Embedded terminal for interactive claude agent sessions (DEC-009).
//
// Renders the live PTY of a running Agent node via xterm.js: output arrives on
// the `agent_terminal_output` Tauri event, keystrokes go back through the
// `agent_terminal_input` command, and resizes through `agent_terminal_resize`.
// Session lifecycle (started / awaiting_user / ended) arrives on
// `agent_session_state`; in completion_mode "manual" the awaiting_user state
// shows a "Complete node" button wired to `complete_agent_node`.
//
// Self-contained: takes only the runId and manages its own listeners. The
// panel renders nothing when no interactive session is live for the run.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  ipc,
  type AgentSessionStatePayload,
  type AgentTerminalOutputPayload,
} from "../../types/ipc";

interface AgentSessionTerminalProps {
  runId: string;
}

interface LiveSession {
  nodeId: string;
  state: "started" | "awaiting_user";
  sessionId: string;
}

export function AgentSessionTerminal({ runId }: AgentSessionTerminalProps) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [completing, setCompleting] = useState(false);

  // Track session lifecycle for this run.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    listen<AgentSessionStatePayload>("agent_session_state", (ev) => {
      if (ev.payload.run_id !== runId) return;
      if (ev.payload.state === "ended") {
        setSession((s) => (s && s.nodeId === ev.payload.node_id ? null : s));
        setCompleting(false);
      } else {
        setSession({
          nodeId: ev.payload.node_id,
          state: ev.payload.state,
          sessionId: ev.payload.session_id,
        });
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [runId]);

  const handleComplete = useCallback(async () => {
    if (!session) return;
    setCompleting(true);
    try {
      await ipc.completeAgentNode({ runId, nodeId: session.nodeId });
    } catch {
      setCompleting(false);
    }
  }, [runId, session]);

  if (!session) return null;

  return (
    <div className="lr-panel ast-panel" data-testid="agent-session-terminal">
      <div className="panel-header ast-header">
        <span>
          AGENT SESSION{" "}
          <span className="ast-session-id" title={session.sessionId}>
            {session.sessionId.slice(0, 8)}
          </span>
        </span>
        {session.state === "awaiting_user" && (
          <button
            className="toolbar-btn ast-complete-btn"
            onClick={handleComplete}
            disabled={completing}
            data-testid="complete-agent-node-btn"
          >
            {completing ? "Completing..." : "Complete node"}
          </button>
        )}
      </div>
      {session.state === "awaiting_user" && (
        <div className="ast-hint">
          Turn ended — session held open. Keep chatting in the terminal, or
          complete the node to continue the workflow.
        </div>
      )}
      <XtermSurface runId={runId} nodeId={session.nodeId} />
    </div>
  );
}

interface XtermSurfaceProps {
  runId: string;
  nodeId: string;
}

/** The actual xterm.js mount; remounts per node session. */
function XtermSurface({ runId, nodeId }: XtermSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      convertEol: false,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      cursorBlink: true,
      theme: { background: "#0a0e14" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    // Keystrokes -> PTY.
    const dataSub = term.onData((data) => {
      void Promise.resolve(ipc.agentTerminalInput({ runId, nodeId, data })).catch(() => {
        /* session ended between render and keypress — expected, not an error */
      });
    });

    // PTY bytes -> terminal.
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    listen<AgentTerminalOutputPayload>("agent_terminal_output", (ev) => {
      if (ev.payload.run_id !== runId || ev.payload.node_id !== nodeId) return;
      term.write(ev.payload.data);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    // Resize: refit on container changes and propagate to the PTY.
    const sendResize = () => {
      void Promise.resolve(
        ipc.agentTerminalResize({ runId, nodeId, cols: term.cols, rows: term.rows })
      ).catch(() => {});
    };
    const ro = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    ro.observe(el);
    sendResize();

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      unlisten?.();
      term.dispose();
    };
  }, [runId, nodeId]);

  return <div ref={containerRef} className="ast-terminal" data-testid="agent-terminal-surface" />;
}
