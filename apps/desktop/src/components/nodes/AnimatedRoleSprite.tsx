import type { NodeKind, NodeState } from "../../types/workflow";
import { useAnimationTick } from "../../hooks/useAnimationTick";

const SPRITE_PATH: Record<NodeKind, string> = {
  start: "/assets/command-deck/sprites/role-start-idle.webp",
  agent: "/assets/command-deck/sprites/role-agent-idle.webp",
  tool: "/assets/command-deck/sprites/role-tool-idle.webp",
  router: "/assets/command-deck/sprites/role-router-idle.webp",
  memory: "/assets/command-deck/sprites/role-memory-idle.webp",
  human_review: "/assets/command-deck/sprites/role-review-idle.webp",
  end: "/assets/command-deck/sprites/role-end-idle.webp",
};

export function spriteFrameForState(state: NodeState, tick: number): number {
  switch (state) {
    case "running":
      return Math.floor(tick / 3) % 4;
    case "waiting":
      return Math.floor(tick / 10) % 4;
    case "paused":
      return 1;
    case "succeeded":
      return 2;
    case "failed":
    case "skipped":
    case "queued":
      return 0;
    case "idle":
    default:
      return Math.floor(tick / 7) % 4;
  }
}

interface AnimatedRoleSpriteProps {
  kind: NodeKind;
  state: NodeState;
}

export function AnimatedRoleSprite({ kind, state }: AnimatedRoleSpriteProps) {
  const tick = useAnimationTick();
  const frame = spriteFrameForState(state, tick);

  return (
    <span
      className="role-node-sprite"
      data-testid="animated-role-sprite"
      data-frame={frame}
      aria-hidden="true"
    >
      <img
        src={SPRITE_PATH[kind]}
        alt=""
        width="512"
        height="128"
        draggable={false}
        style={{ transform: `translateX(-${frame * 25}%)` }}
        onError={(event) => {
          event.currentTarget.parentElement?.setAttribute("hidden", "");
        }}
      />
    </span>
  );
}
