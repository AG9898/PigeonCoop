import { WorkflowCanvas } from "../components/canvas/WorkflowCanvas";

export function BuilderView() {
  return (
    <div className="view builder-view">
      <div className="view-header">
        <span className="view-title">BUILDER</span>
        <span className="view-subtitle">workflow design canvas</span>
      </div>
      <div className="view-body" style={{ overflow: "hidden" }}>
        <WorkflowCanvas />
      </div>
    </div>
  );
}
