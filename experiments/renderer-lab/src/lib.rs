//! Synthetic presentation only: no executor, workflow mutations, timers or IPC.
use serde::{Deserialize, Serialize};
#[cfg(target_arch = "wasm32")]
mod wasm;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Actor {
    pub id: String,
    pub pos: Point,
    pub frame: u32,
    pub variant: u32,
    pub facing: String,
    pub action: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Scene {
    pub time_ms: u32,
    pub phase: String,
    pub status: String,
    pub coverage: String,
    pub scenario: String,
    pub reduced_motion: bool,
    pub actors: Vec<Actor>,
}
pub const ROUTE: [Point; 5] = [
    Point { x: 76., y: 139. },
    Point { x: 116., y: 139. },
    Point { x: 116., y: 87. },
    Point { x: 225., y: 87. },
    Point { x: 225., y: 139. },
];
pub fn route_sample(progress: f32) -> (Point, &'static str) {
    let distances: Vec<f32> = ROUTE
        .windows(2)
        .map(|p| ((p[1].x - p[0].x).powi(2) + (p[1].y - p[0].y).powi(2)).sqrt())
        .collect();
    let mut remaining = progress.clamp(0., 1.) * distances.iter().sum::<f32>();
    for (pair, length) in ROUTE.windows(2).zip(distances) {
        if remaining <= length {
            let ratio = remaining / length;
            let facing = if pair[1].x < pair[0].x {
                "left"
            } else if pair[1].y < pair[0].y {
                "up"
            } else if pair[1].y > pair[0].y {
                "down"
            } else {
                "right"
            };
            return (
                Point {
                    x: pair[0].x + (pair[1].x - pair[0].x) * ratio,
                    y: pair[0].y + (pair[1].y - pair[0].y) * ratio,
                },
                facing,
            );
        }
        remaining -= length;
    }
    (ROUTE[4], "right")
}
/// Millisecond-based sampling makes pause/seek independent of wall-clock history.
pub fn clip_frame(action: &str, elapsed_ms: u32, reduced_motion: bool) -> u32 {
    if reduced_motion {
        return if action == "interact" { 4 } else { 0 };
    }
    match action {
        "walk" => 2 + (elapsed_ms / 140) % 2,
        "interact" => {
            if elapsed_ms % 480 < 180 {
                4
            } else {
                5
            }
        }
        _ => {
            if elapsed_ms % 800 < 600 {
                0
            } else {
                1
            }
        }
    }
}
pub fn sample_scene(time_ms: u32, count: usize, scenario: &str, reduced: bool) -> Scene {
    let t = time_ms.min(8000);
    let interrupted = scenario != "normal" && t >= 2200;
    let sample_t = if interrupted { 2200 } else { t };
    let (mut pos, mut facing) = route_sample((sample_t as f32 - 800.) / 2700.);
    let mut phase = if t < 800 {
        "idle"
    } else if t < 3500 {
        "walk"
    } else if t < 4700 {
        "interact"
    } else {
        "settled"
    };
    let mut status = if t < 800 {
        "Ready"
    } else if t < 4700 {
        "Running"
    } else {
        "Succeeded"
    };
    let mut coverage = "fixture captured";
    if interrupted {
        phase = "interrupted";
        status = match scenario {
            "cancelled" => "Cancelled",
            "failure" => "Failed",
            _ => "Running",
        };
        if scenario == "stale" {
            coverage = "owner contact lost; outcome unknown";
        }
    }
    if !interrupted && t >= 3500 {
        facing = "right";
    }
    if reduced && !interrupted && t >= 800 {
        pos = ROUTE[4];
        facing = "right";
    }
    let action = if phase == "interrupted" || phase == "settled" {
        "idle"
    } else {
        phase
    };
    let clip_started = match phase {
        "walk" => 800,
        "interact" => 3500,
        "settled" => 4700,
        _ => 0,
    };
    let frame = clip_frame(
        action,
        t.saturating_sub(clip_started),
        reduced || interrupted,
    );
    let mut actors = vec![
        Actor {
            id: "worker-a".into(),
            pos,
            frame,
            variant: 0,
            facing: facing.into(),
            action: phase.into(),
        },
        Actor {
            id: "worker-b".into(),
            pos: Point { x: 253., y: 139. },
            frame: if phase == "interact" {
                5
            } else {
                clip_frame("idle", t, reduced || interrupted)
            },
            variant: 1,
            facing: "left".into(),
            action: if phase == "interact" {
                "receive"
            } else {
                "idle"
            }
            .into(),
        },
    ];
    for i in 2..count.clamp(2, 100) {
        actors.push(Actor {
            id: format!("fixture-{i:03}"),
            pos: Point {
                x: if count <= 20 {
                    32. + ((i - 2) % 9) as f32 * 28.
                } else {
                    23. + ((i - 2) % 17) as f32 * 16.
                },
                y: if count <= 20 {
                    184. + ((i - 2) / 9) as f32 * 37.
                } else {
                    174. + ((i - 2) / 17) as f32 * 8.
                },
            },
            frame: clip_frame("idle", t + (i as u32 * 37), reduced || interrupted),
            variant: (i % 2) as u32,
            facing: "right".into(),
            action: "idle".into(),
        });
    }
    Scene {
        time_ms: t,
        phase: phase.into(),
        status: status.into(),
        coverage: coverage.into(),
        scenario: scenario.into(),
        reduced_motion: reduced,
        actors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seek_is_independent_of_prior_sampling() {
        let expected = sample_scene(3600, 20, "normal", false);
        for t in [7900, 500, 2200, 8000, 0] {
            let _ = sample_scene(t, 100, "failure", true);
        }
        assert_eq!(expected, sample_scene(3600, 20, "normal", false));
    }
    #[test]
    fn route_does_not_enter_blocked_prop() {
        for i in 0..=1000 {
            let (p, _) = route_sample(i as f32 / 1000.);
            assert!(!(p.x > 140. && p.x < 198. && p.y > 107. && p.y < 155.));
        }
    }
    #[test]
    fn contact_loss_is_not_success_or_failure() {
        let s = sample_scene(7900, 2, "stale", false);
        assert_eq!(s.status, "Running");
        assert!(s.coverage.contains("unknown"));
        assert_eq!(
            s.actors[0].pos,
            sample_scene(2300, 2, "stale", false).actors[0].pos
        );
    }
    #[test]
    fn cancellation_and_failure_interrupt_movement() {
        for (scenario, status) in [("cancelled", "Cancelled"), ("failure", "Failed")] {
            let a = sample_scene(2400, 2, scenario, false);
            let b = sample_scene(7999, 2, scenario, false);
            assert_eq!(a.actors, b.actors);
            assert_eq!(a.status, status);
        }
    }
    #[test]
    fn reduced_motion_preserves_recorded_outcome() {
        for t in [0, 900, 3200, 3800, 4900, 8000] {
            let a = sample_scene(t, 2, "normal", false);
            let b = sample_scene(t, 2, "normal", true);
            assert_eq!(a.status, b.status);
            if t >= 800 {
                assert_eq!(b.actors[0].pos, ROUTE[4]);
            }
        }
    }
    #[test]
    fn clip_boundaries_and_anchors_are_stable() {
        assert_eq!(clip_frame("walk", 139, false), 2);
        assert_eq!(clip_frame("walk", 140, false), 3);
        assert_eq!(clip_frame("walk", 280, false), 2);
        assert_eq!(clip_frame("interact", 240, false), 5);
        assert_eq!(clip_frame("walk", 999, true), 0);
        for t in (0..=8000).step_by(17) {
            for a in sample_scene(t, 100, "normal", false).actors {
                assert!(a.frame < 6);
            }
        }
    }
    #[test]
    fn exact_handoff_and_settle_positions() {
        assert_eq!(
            sample_scene(3500, 2, "normal", false).actors[0].pos,
            ROUTE[4]
        );
        assert_eq!(sample_scene(4700, 2, "normal", false).status, "Succeeded");
    }
    #[test]
    fn count_and_time_are_bounded() {
        assert_eq!(
            sample_scene(u32::MAX, 9999, "normal", false).actors.len(),
            100
        );
        assert_eq!(sample_scene(u32::MAX, 2, "normal", false).time_ms, 8000);
    }
    #[cfg(feature = "native")]
    #[test]
    fn macroquad_library_rectangles_match_seekable_sampler() {
        use macroquad::experimental::animation::{AnimatedSprite, Animation};
        for row in 0..2 {
            let mut player = AnimatedSprite::new(
                32,
                48,
                &[Animation {
                    name: "fixture".into(),
                    row,
                    frames: 6,
                    fps: 10,
                }],
                false,
            );
            for frame in [0, 3, 1, 5, 2, 4, 0] {
                player.set_frame(frame);
                let rect = player.frame().source_rect;
                assert_eq!(rect.x, frame as f32 * 32.);
                assert_eq!(rect.y, row as f32 * 48.);
            }
        }
    }
}
