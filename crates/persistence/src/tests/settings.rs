// Dedicated settings repository tests.
// Supplements the inline tests in repositories/settings.rs with scenarios covering
// diverse JSON value types, key naming edge cases, and concurrent set behaviour.

use serde_json::json;

use crate::repositories::settings::SettingsRepository;
use crate::sqlite::Db;

fn db() -> Db {
    Db::open_in_memory().expect("in-memory db")
}

// ── Null JSON value is stored and retrieved ───────────────────────────────────

#[test]
fn null_json_value_roundtrips() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("nullable_key", &json!(null)).unwrap();
    let value = repo.get_setting("nullable_key").unwrap();
    assert_eq!(value, Some(json!(null)));
}

// ── All primitive JSON types round-trip ──────────────────────────────────────

#[test]
fn integer_json_value_roundtrips() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("max_retries", &json!(42)).unwrap();
    let v = repo.get_setting("max_retries").unwrap().unwrap();
    assert_eq!(v, json!(42));
}

#[test]
fn float_json_value_roundtrips() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("zoom", &json!(1.75)).unwrap();
    let v = repo.get_setting("zoom").unwrap().unwrap();
    assert_eq!(v, json!(1.75));
}

#[test]
fn bool_json_value_roundtrips() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("show_minimap", &json!(true)).unwrap();
    let v = repo.get_setting("show_minimap").unwrap().unwrap();
    assert_eq!(v, json!(true));

    repo.set_setting("show_minimap", &json!(false)).unwrap();
    let v = repo.get_setting("show_minimap").unwrap().unwrap();
    assert_eq!(v, json!(false));
}

#[test]
fn array_json_value_roundtrips() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    let arr = json!(["alpha", "beta", "gamma"]);
    repo.set_setting("recent_projects", &arr).unwrap();
    let v = repo.get_setting("recent_projects").unwrap().unwrap();
    assert_eq!(v, arr);
}

// ── Keys with similar names do not interfere ─────────────────────────────────

#[test]
fn similar_key_names_do_not_interfere() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("theme", &json!("dark")).unwrap();
    repo.set_setting("theme_dark", &json!("enabled")).unwrap();
    repo.set_setting("theme_dark_mode", &json!(true)).unwrap();

    assert_eq!(repo.get_setting("theme").unwrap(), Some(json!("dark")));
    assert_eq!(repo.get_setting("theme_dark").unwrap(), Some(json!("enabled")));
    assert_eq!(repo.get_setting("theme_dark_mode").unwrap(), Some(json!(true)));
}

// ── Overwrite preserves other keys ───────────────────────────────────────────

#[test]
fn overwrite_one_key_does_not_affect_others() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("a", &json!(1)).unwrap();
    repo.set_setting("b", &json!(2)).unwrap();
    repo.set_setting("c", &json!(3)).unwrap();

    // Update only "b"
    repo.set_setting("b", &json!(99)).unwrap();

    assert_eq!(repo.get_setting("a").unwrap(), Some(json!(1)));
    assert_eq!(repo.get_setting("b").unwrap(), Some(json!(99)));
    assert_eq!(repo.get_setting("c").unwrap(), Some(json!(3)));
}

// ── list_settings ordering ───────────────────────────────────────────────────

#[test]
fn list_settings_ordering_is_lexicographic() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    // Insert in reverse order; list should return alphabetical
    repo.set_setting("zzz", &json!("last")).unwrap();
    repo.set_setting("aaa", &json!("first")).unwrap();
    repo.set_setting("mmm", &json!("middle")).unwrap();

    let list = repo.list_settings().unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].0, "aaa");
    assert_eq!(list[1].0, "mmm");
    assert_eq!(list[2].0, "zzz");
}

// ── set_setting is idempotent when called with same value ────────────────────

#[test]
fn set_setting_same_value_twice_is_idempotent() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    repo.set_setting("key", &json!("value")).unwrap();
    repo.set_setting("key", &json!("value")).unwrap();

    let list = repo.list_settings().unwrap();
    // Only one entry for this key
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].1, json!("value"));
}

// ── Deeply nested object round-trips ─────────────────────────────────────────

#[test]
fn deeply_nested_object_roundtrips() {
    let db = db();
    let repo = SettingsRepository::new(&db);

    let nested = json!({
        "ui": {
            "panels": {
                "left": { "width": 280, "visible": true },
                "right": { "width": 320, "visible": false }
            },
            "theme": "mission-control",
            "font_size": 13
        },
        "execution": {
            "default_shell": "/bin/bash",
            "max_concurrent_nodes": 4
        }
    });

    repo.set_setting("app_config", &nested).unwrap();
    let loaded = repo.get_setting("app_config").unwrap().unwrap();
    assert_eq!(loaded, nested);
}
