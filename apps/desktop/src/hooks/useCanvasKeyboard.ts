// useCanvasKeyboard — keyboard-driven canvas navigation for React Flow.
// Arrow keys pan, +/- zoom, F fits view, Tab cycles node selection, Escape deselects.
// Must be called inside a ReactFlowProvider context.
// See DESIGN_SPEC.md §13.

import { useEffect, useCallback } from "react";
import { useReactFlow } from "reactflow";

const PAN_STEP = 50;

export function useCanvasKeyboard(
  containerRef: React.RefObject<HTMLElement | null>
) {
  const {
    getViewport,
    setViewport,
    zoomIn,
    zoomOut,
    fitView,
    getNodes,
    setNodes,
  } = useReactFlow();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Arrow keys → pan (no modifier keys)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const vp = getViewport();
        switch (e.key) {
          case "ArrowUp":
            e.preventDefault();
            setViewport({ ...vp, y: vp.y + PAN_STEP });
            return;
          case "ArrowDown":
            e.preventDefault();
            setViewport({ ...vp, y: vp.y - PAN_STEP });
            return;
          case "ArrowLeft":
            e.preventDefault();
            setViewport({ ...vp, x: vp.x + PAN_STEP });
            return;
          case "ArrowRight":
            e.preventDefault();
            setViewport({ ...vp, x: vp.x - PAN_STEP });
            return;
        }
      }

      // +/= → zoom in, - → zoom out
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (e.key === "-" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        zoomOut();
        return;
      }

      // F → fit view (without Ctrl/Cmd to avoid browser find)
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        fitView({ padding: 0.2 });
        return;
      }

      // Tab → cycle node selection, Shift+Tab → reverse
      if (e.key === "Tab") {
        e.preventDefault();
        const nodes = getNodes();
        if (nodes.length === 0) return;
        const selectedIdx = nodes.findIndex((n) => n.selected);
        const nextIdx = e.shiftKey
          ? selectedIdx <= 0
            ? nodes.length - 1
            : selectedIdx - 1
          : (selectedIdx + 1) % nodes.length;
        setNodes(
          nodes.map((n, i) => ({ ...n, selected: i === nextIdx }))
        );
        return;
      }

      // Escape → deselect all
      if (e.key === "Escape") {
        const nodes = getNodes();
        if (nodes.some((n) => n.selected)) {
          setNodes(nodes.map((n) => ({ ...n, selected: false })));
        }
        return;
      }
    },
    [getViewport, setViewport, zoomIn, zoomOut, fitView, getNodes, setNodes]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, handleKeyDown]);
}
