//! Bounded, display-isolated native renderer comparison. No real agent calls.
use macroquad::prelude::*;
use pigeoncoop_renderer_lab::{sample_scene, Scene};
use serde::Deserialize;
use std::time::Instant;

#[derive(Deserialize)]
struct Shape {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    color: u32,
}
#[derive(Deserialize)]
struct Prop {
    x: f32,
    y: f32,
    rects: Vec<Shape>,
}
#[derive(Deserialize)]
struct Map {
    width: f32,
    height: f32,
    ground: Vec<Shape>,
    props: Vec<Prop>,
}
fn color(rgb: u32) -> Color {
    Color::from_rgba((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8, 255)
}
fn rectangle(s: &Shape, offset: Vec2) {
    draw_rectangle(s.x + offset.x, s.y + offset.y, s.w, s.h, color(s.color));
}
fn configuration() -> Conf {
    // This experiment refuses to open on the user's normal desktop.
    if std::env::var("PIGEONCOOP_PRIVATE_DISPLAY").as_deref() != Ok("1") {
        panic!("Capture requires a private Xvfb display; no visible fallback is allowed");
    }
    #[cfg(target_os = "linux")]
    {
        let display = std::env::var("DISPLAY").expect("Xvfb DISPLAY missing");
        assert!(
            display.starts_with(':') && display != ":0" && display != ":0.0",
            "Refusing default desktop"
        );
    }
    Conf {
        window_title: "PigeonCoop isolated Macroquad study".into(),
        window_width: 1280,
        window_height: 800,
        high_dpi: false,
        window_resizable: true,
        sample_count: 1,
        ..Default::default()
    }
}
fn draw_world(map: &Map, atlas: &Texture2D, scene: &Scene) {
    for shape in &map.ground {
        rectangle(shape, Vec2::ZERO);
    }
    let motion = if scene.reduced_motion || scene.phase == "interrupted" {
        0.
    } else {
        ((scene.time_ms / 420) % 2) as f32
    };
    for (x, y, w, h, c) in [
        (20., 182., 43., 18., 0x7faeb1),
        (23., 185. + motion, 16., 2., 0xb2d0be),
        (43., 192. - motion, 14., 2., 0xb2d0be),
    ] {
        draw_rectangle(x, y, w, h, color(c));
    }
    for i in 0..5 {
        draw_rectangle(
            76. + i as f32 * 5. + motion,
            44. + (i % 2) as f32 * 3.,
            2.,
            5.,
            color(0x88a65f),
        );
    }
    let mut layers: Vec<(f32, bool, usize)> = map
        .props
        .iter()
        .enumerate()
        .map(|(i, p)| (p.y, false, i))
        .chain(
            scene
                .actors
                .iter()
                .enumerate()
                .map(|(i, a)| (a.pos.y, true, i)),
        )
        .collect();
    layers.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (_, is_actor, index) in layers {
        if is_actor {
            let a = &scene.actors[index];
            draw_texture_ex(
                atlas,
                a.pos.x.round() - 16.,
                a.pos.y.round() - 44.,
                WHITE,
                DrawTextureParams {
                    source: Some(Rect::new(
                        a.frame as f32 * 32.,
                        a.variant as f32 * 48.,
                        32.,
                        48.,
                    )),
                    dest_size: Some(vec2(32., 48.)),
                    flip_x: a.facing == "left",
                    ..Default::default()
                },
            );
        } else {
            let p = &map.props[index];
            for shape in &p.rects {
                rectangle(shape, vec2(p.x, p.y));
            }
        }
    }
    let a = &scene.actors[0];
    draw_ellipse_lines(
        a.pos.x.round(),
        a.pos.y.round() + 1.,
        13.,
        4.,
        0.,
        1.,
        color(0xf9f0c6),
    );
    draw_rectangle(
        a.pos.x.round() - 2.,
        a.pos.y.round() - 47.,
        4.,
        3.,
        color(if scene.phase == "interrupted" {
            0xb16a44
        } else {
            0x3f654f
        }),
    );
}
fn draw_panel(scene: &Scene) {
    clear_background(color(0xf5f1e5));
    draw_rectangle(0., 0., 1280., 88., color(0xfaf7ef));
    draw_text(
        "PigeonCoop / first clearing",
        30.,
        45.,
        28.,
        color(0x263d35),
    );
    draw_text(
        "SYNTHETIC FIXTURE / native Macroquad / private Linux display",
        30.,
        70.,
        17.,
        color(0x6d786b),
    );
    draw_rectangle(986., 88., 294., 712., color(0xf0eee2));
    for (i, line) in [
        "SELECTED SESSION",
        "worker-a",
        "Fixture action: review-01",
        "worker-a -> worker-b",
        &format!("Recorded: {}", scene.status),
        &format!("Action: {}", scene.phase),
        &format!("Coverage: {}", scene.coverage),
        "Evidence: fixture://review-01",
        "No real commands executed",
        "Rust sampling; PNG atlas",
        "Foot anchor: [16,44]",
    ]
    .iter()
    .enumerate()
    {
        draw_text(
            line,
            1006.,
            125. + i as f32 * 43.,
            if i == 1 { 25. } else { 16. },
            color(0x354c3d),
        );
    }
    draw_text(
        &format!("Replay: {:.2} / 8.00 seconds", scene.time_ms as f32 / 1000.),
        30.,
        766.,
        20.,
        color(0x55704f),
    );
}
fn stats(values: &[f64]) -> serde_json::Value {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    serde_json::json!({"p50":sorted[sorted.len()/2],"p95":sorted[sorted.len()*95/100],"p99":sorted[sorted.len()*99/100],"max":sorted.last()})
}

#[macroquad::main(configuration)]
async fn main() {
    let startup = Instant::now();
    let output = "evidence/linux-macroquad";
    std::fs::create_dir_all(output).unwrap();
    let map: Map = serde_json::from_str(include_str!("../assets/scene.json")).unwrap();
    let atlas = Texture2D::from_file_with_format(
        include_bytes!("../assets/actors.png"),
        Some(ImageFormat::Png),
    );
    atlas.set_filter(FilterMode::Nearest);
    let target = render_target(map.width as u32, map.height as u32);
    target.texture.set_filter(FilterMode::Nearest);
    let camera = Camera2D {
        render_target: Some(target.clone()),
        ..Camera2D::from_display_rect(Rect::new(0., 0., map.width, map.height))
    };
    let shots = [
        ("01-idle", 0, "normal", false, 2),
        ("02-approach", 2000, "normal", false, 2),
        ("03-handoff", 3700, "normal", false, 2),
        ("04-settled", 5200, "normal", false, 2),
        ("05-contact-lost", 5200, "stale", false, 2),
        ("06-cancelled", 5200, "cancelled", false, 2),
        ("07-failure", 5200, "failure", false, 2),
        ("08-reduced", 2000, "normal", true, 2),
        ("09-stress-100", 3700, "normal", false, 100),
    ];
    let mut snapshots = Vec::new();
    for (name, time, scenario, reduced, count) in shots {
        let scene = sample_scene(time, count, scenario, reduced);
        set_camera(&camera);
        clear_background(color(0xdbe2c6));
        draw_world(&map, &atlas, &scene);
        set_default_camera();
        draw_panel(&scene);
        draw_texture_ex(
            &target.texture,
            205.,
            217.,
            WHITE,
            DrawTextureParams {
                dest_size: Some(vec2(608., 448.)),
                flip_y: true,
                ..Default::default()
            },
        );
        get_screen_data().export_png(&format!("{output}/{name}.png"));
        next_frame().await;
        snapshots.push(scene);
    }
    let startup_to_captures_ms = startup.elapsed().as_secs_f64() * 1000.;
    let mut results = Vec::new();
    for count in [2, 20, 100] {
        let mut frame_times = Vec::new();
        let mut submit_times = Vec::new();
        let mut prior = Instant::now();
        for i in 0..240 {
            let before = Instant::now();
            if i >= 30 {
                frame_times.push(prior.elapsed().as_secs_f64() * 1000.);
            }
            prior = before;
            let scene = sample_scene((i * 17) % 8000, count, "normal", false);
            set_camera(&camera);
            clear_background(color(0xdbe2c6));
            draw_world(&map, &atlas, &scene);
            set_default_camera();
            draw_panel(&scene);
            draw_texture_ex(
                &target.texture,
                205.,
                217.,
                WHITE,
                DrawTextureParams {
                    dest_size: Some(vec2(608., 448.)),
                    flip_y: true,
                    ..Default::default()
                },
            );
            submit_times.push(before.elapsed().as_secs_f64() * 1000.);
            next_frame().await;
        }
        results.push(serde_json::json!({"count":count,"samples":210,"frame_intervals_ms":stats(&frame_times),"cpu_submit_ms":stats(&submit_times[30..]),"stalls_over_33ms":frame_times.iter().filter(|t|**t>33.33).count()}));
    }
    std::fs::write(format!("{output}/native-report.json"),serde_json::to_vec_pretty(&serde_json::json!({"scope":"Linux executable under private WSL/Xvfb display; software OpenGL forced; not native Windows or Linux hardware GPU qualification","startup_to_nine_captures_ms":startup_to_captures_ms,"benchmark":results,"snapshots":snapshots})).unwrap()).unwrap();
    println!("Captured native Macroquad fixture and benchmarks on isolated display");
}
