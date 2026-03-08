// Trivial smoke test: verify the app launches and the window title is set.
// Prerequisites: tauri-driver running, debug binary built.
// See docs/TESTING.md §3 for full setup instructions.

describe('Agent Arcade — smoke test', () => {
  it('app loads and window title is set', async () => {
    const title = await browser.getTitle();
    expect(title).toBeTruthy();
    expect(typeof title).toBe('string');
  });

  it('app root element is present in the DOM', async () => {
    const root = await $('#root');
    await expect(root).toExist();
  });
});
