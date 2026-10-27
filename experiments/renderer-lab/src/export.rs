use pigeoncoop_renderer_lab::sample_scene;
fn main() {
    let mut variants = serde_json::Map::new();
    for scenario in ["normal", "stale", "cancelled", "failure"] {
        for reduced in [false, true] {
            let frames: Vec<_> = (0..=480)
                .map(|i| sample_scene(i * 8000 / 480, 2, scenario, reduced))
                .collect();
            variants.insert(
                format!("{scenario}-{}", if reduced { "reduced" } else { "motion" }),
                serde_json::to_value(frames).unwrap(),
            );
        }
    }
    let manifest = serde_json::json!({"width":192,"height":96,"frame_width":32,"frame_height":48,"foot_anchor":[16,44],"clips":{"idle":[0,1],"walk":[2,3],"interact":[4,5]},"source":"hand-authored SVG test atlas; V2-inspired, not final production art"});
    std::fs::write(
        "web/fixture.json",
        serde_json::to_vec(&serde_json::json!({"fps":60,"duration_ms":8000,"variants":variants}))
            .unwrap(),
    )
    .unwrap();
    std::fs::write(
        "assets/atlas.json",
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    println!("Exported 8 deterministic fixture variants at 60 samples/second");
}
