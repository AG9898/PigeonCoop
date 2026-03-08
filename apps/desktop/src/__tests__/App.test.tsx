import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "../app/App";

describe("App shell and view router", () => {
  it("renders all four nav items", () => {
    render(<App />);
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.getByText("Live Run")).toBeTruthy();
    expect(screen.getByText("Replay")).toBeTruthy();
    expect(screen.getByText("Library")).toBeTruthy();
  });

  it("shows Builder view by default", () => {
    render(<App />);
    expect(screen.getByText("BUILDER")).toBeTruthy();
  });

  it("switches to Live Run view on nav click", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Live Run"));
    expect(screen.getByText("LIVE RUN")).toBeTruthy();
  });

  it("switches to Replay view on nav click", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Replay"));
    expect(screen.getByText("REPLAY")).toBeTruthy();
  });

  it("switches to Library view on nav click", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Library"));
    expect(screen.getByText("LIBRARY")).toBeTruthy();
  });

  it("switches views with keyboard shortcuts", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByText("LIVE RUN")).toBeTruthy();
    fireEvent.keyDown(window, { key: "3" });
    expect(screen.getByText("REPLAY")).toBeTruthy();
    fireEvent.keyDown(window, { key: "4" });
    expect(screen.getByText("LIBRARY")).toBeTruthy();
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.getByText("BUILDER")).toBeTruthy();
  });

  it("ignores keyboard shortcuts when modifier keys are held", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "2", ctrlKey: true });
    expect(screen.getByText("BUILDER")).toBeTruthy();
  });

  it("displays the brand name", () => {
    render(<App />);
    expect(screen.getByText("AGENT ARCADE")).toBeTruthy();
  });
});
