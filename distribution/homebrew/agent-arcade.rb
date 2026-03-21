# Homebrew formula for Agent Arcade
# Usage: brew install agent-arcade (once tapped)
#
# To test locally:
#   brew install --build-from-source ./distribution/homebrew/agent-arcade.rb
#
# Maintainers: update the `url`, `sha256`, and `version` on each release.
# The release workflow can automate this via `brew bump-formula-pr`.

class AgentArcade < Formula
  desc "Visual workflow builder and runtime monitor for agent systems"
  homepage "https://github.com/anthropics/agent-arcade"
  version "0.1.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/anthropics/agent-arcade/releases/download/v#{version}/agent-arcade_#{version}_aarch64.dmg"
      sha256 "PLACEHOLDER_ARM64_SHA256"
    else
      url "https://github.com/anthropics/agent-arcade/releases/download/v#{version}/agent-arcade_#{version}_x64.dmg"
      sha256 "PLACEHOLDER_X64_SHA256"
    end
  end

  def install
    # The .dmg contains the .app bundle
    prefix.install "Agent Arcade.app"
    bin.write_exec_script "#{prefix}/Agent Arcade.app/Contents/MacOS/agent-arcade"
  end

  test do
    assert_predicate bin/"agent-arcade", :exist?
  end
end
