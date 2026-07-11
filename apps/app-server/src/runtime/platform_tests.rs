use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::MemorySourceRecord;

use super::platform::{
    allowed_attachment_mime_type, attachment_size_limit, collect_named_files, context_suggestions,
    detect_attachment_mime_type, expand_user_path, frontmatter, frontmatter_value, home_dir,
    memory_source_candidates, memory_source_record, memory_suggestions, normalize_plugin_id,
    parse_plugin_enabled_config, parse_plugin_manifest, parse_skill_file, plugin_enabled_config,
    plugin_id_for_manifest, plugin_marketplace, plugin_source, push_memory_source,
    skill_markdown_files, skill_roots, skill_source,
};
use super::util::{MAX_AUDIO_SIZE, MAX_DOCUMENT_SIZE, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE};

#[test]
fn attachment_detection_covers_magic_bytes_extensions_limits_and_allowlist() {
    let cases: &[(&str, &[u8], &str)] = &[
        ("image.png", b"\x89PNG\r\n\x1a\nbody", "image/png"),
        ("photo.jpg", &[0xff, 0xd8, 0xff, 0x00], "image/jpeg"),
        ("animation.gif", b"GIF87a", "image/gif"),
        ("animation.gif", b"GIF89a", "image/gif"),
        ("image.webp", b"RIFFxxxxWEBPmore", "image/webp"),
        ("audio.wav", b"RIFFxxxxWAVEfmt ", "audio/wav"),
        ("audio.mp3", b"ID3tag", "audio/mpeg"),
        ("audio.mp3", &[0xff, 0xfb, 0x90, 0x64], "audio/mpeg"),
        ("voice.m4a", b"\0\0\0\x18ftypM4A \0", "audio/mp4"),
        ("clip.mp4", b"\0\0\0\x18ftypisom", "video/mp4"),
        ("note.txt", b"plain text", "text/plain"),
        ("note.md", b"# title", "text/markdown"),
        ("note.markdown", b"# title", "text/markdown"),
        ("table.csv", b"a,b", "text/csv"),
        ("page.html", b"<html>", "text/html"),
        ("page.htm", b"<html>", "text/html"),
        ("style.css", b"body {}", "text/css"),
        ("data.json", b"{}", "application/json"),
        ("feed.xml", b"<feed />", "application/xml"),
        ("script.js", b"console.log(1)", "application/javascript"),
        ("script.mjs", b"export {}", "application/javascript"),
        (
            "script.cjs",
            b"module.exports = {}",
            "application/javascript",
        ),
        ("movie.webm", b"webm", "video/webm"),
        ("movie.mov", b"mov", "video/quicktime"),
        ("voice.m4a", b"m4a without ftyp", "audio/mp4"),
        ("voice.aac", b"aac without ftyp", "audio/aac"),
        ("sound.ogg", b"ogg", "audio/ogg"),
        ("sound.opus", b"opus", "audio/ogg"),
        ("sound.flac", b"flac", "audio/flac"),
        ("README", b"ascii\ttext\n", "text/plain"),
        ("blob.bin", &[0, 159, 146, 150], "application/octet-stream"),
    ];

    for (name, data, expected) in cases {
        assert_eq!(
            detect_attachment_mime_type(Path::new(name), data),
            *expected
        );
    }

    for mime_type in [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "audio/wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/mp4",
        "audio/aac",
        "audio/webm",
        "audio/ogg",
        "audio/opus",
        "audio/flac",
        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime",
        "text/plain",
        "text/html",
        "text/css",
        "application/json",
        "application/xml",
        "application/javascript",
        "text/markdown",
        "text/csv",
    ] {
        assert!(allowed_attachment_mime_type(mime_type), "{mime_type}");
    }

    assert!(!allowed_attachment_mime_type("application/pdf"));
    assert_eq!(attachment_size_limit("image/png"), MAX_IMAGE_SIZE);
    assert_eq!(attachment_size_limit("audio/mpeg"), MAX_AUDIO_SIZE);
    assert_eq!(attachment_size_limit("video/mp4"), MAX_VIDEO_SIZE);
    assert_eq!(attachment_size_limit("application/json"), MAX_DOCUMENT_SIZE);
}

#[test]
fn memory_and_context_helpers_report_records_candidates_and_suggestions() {
    let candidates = memory_source_candidates();
    assert!(candidates.iter().any(|(scope, path)| {
        scope == "admin" && path.as_path() == Path::new("/etc/codex/AGENTS.md")
    }));
    assert!(candidates
        .iter()
        .any(|(scope, path)| scope == "project" && path.ends_with("AGENTS.md")));

    let mut pushed = Vec::new();
    let mut seen = BTreeSet::new();
    let duplicate = PathBuf::from("/tmp/taskforceai-memory.md");
    push_memory_source(&mut pushed, &mut seen, "repo", duplicate.clone());
    push_memory_source(&mut pushed, &mut seen, "repo", duplicate);
    assert_eq!(pushed.len(), 1);

    let root = temp_root("memory");
    fs::create_dir_all(&root).expect("memory fixture dir should be created");
    let file = root.join("AGENTS.md");
    fs::write(&file, "abcdefgh").expect("memory fixture should write");
    let record = memory_source_record("repo".to_string(), file);
    assert!(record.exists);
    assert_eq!(record.bytes, 8);
    assert_eq!(record.estimated_tokens, 2);

    let missing = memory_source_record("repo".to_string(), root.join("missing.md"));
    assert!(!missing.exists);
    assert_eq!(missing.bytes, 0);

    let no_memory = memory_suggestions(&[missing]);
    assert!(no_memory
        .iter()
        .any(|suggestion| suggestion.starts_with("No memory files were found")));

    let large = MemorySourceRecord {
        scope: "repo".to_string(),
        path: "/tmp/large.md".to_string(),
        exists: true,
        bytes: 20_004,
        estimated_tokens: 5_001,
    };
    let suggestions = memory_suggestions(&[record, large]);
    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.starts_with("Some memory files are large")));
    assert!(!suggestions
        .iter()
        .any(|suggestion| suggestion.starts_with("No memory files were found")));

    let context = context_suggestions(26, 1, 11);
    assert_eq!(context_suggestions(0, 0, 0).len(), 3);
    assert_eq!(context.len(), 6);
    assert!(context
        .iter()
        .any(|suggestion| suggestion.contains("/pending")));

    fs::remove_dir_all(root).expect("memory fixture should be removed");
}

#[test]
fn home_dependent_platform_helpers_cover_missing_default_and_configured_home() {
    let _guard = super::ENV_LOCK.lock().expect("env lock should not poison");
    let saved_home = std::env::var_os("HOME");
    std::env::remove_var("HOME");

    assert_eq!(home_dir(), None);
    assert_eq!(expand_user_path("~"), PathBuf::from("~"));
    assert_eq!(expand_user_path("~/project"), PathBuf::from("~/project"));
    assert_eq!(plugin_enabled_config().len(), 0);
    assert_eq!(skill_source(Path::new("/tmp/.agents/skills")), "repo");

    let home = temp_root("home");
    fs::create_dir_all(home.join(".codex")).expect("home config dir should be created");
    fs::write(
        home.join(".codex").join("config.toml"),
        "[plugins.\"browser@openai-bundled\"]\nenabled = false\n",
    )
    .expect("plugin config should write");
    std::env::set_var("HOME", &home);

    assert_eq!(home_dir(), Some(home.clone()));
    assert_eq!(expand_user_path("~"), home);
    assert_eq!(expand_user_path("~/project"), home.join("project"));
    assert_eq!(
        plugin_enabled_config().get("browser@openai-bundled"),
        Some(&false)
    );
    assert_eq!(skill_source(&home.join(".agents").join("skills")), "user");

    restore_env("HOME", saved_home);
    fs::remove_dir_all(home).expect("home fixture should be removed");
}

#[test]
fn skill_helpers_parse_frontmatter_and_source_roots() {
    let root = temp_root("skills");
    let skill_dir = root.join("ship-rust");
    fs::create_dir_all(&skill_dir).expect("skill fixture dir should be created");
    let skill_path = skill_dir.join("SKILL.md");
    fs::write(
        &skill_path,
        "---\nname: 'ship-rust'\ndescription: \"Ship Rust app work.\"\n---\nBody\n",
    )
    .expect("skill file should write");

    let files = skill_markdown_files(&root).expect("skill files should list");
    assert_eq!(files, vec![skill_path.clone()]);
    assert!(skill_markdown_files(&root.join("missing")).is_err());

    let skill = parse_skill_file(&skill_path, "repo")
        .expect("skill should parse")
        .expect("skill should be present");
    assert_eq!(skill.name, "ship-rust");
    assert_eq!(skill.description, "Ship Rust app work.");
    assert_eq!(skill.source, "repo");

    let no_frontmatter = root.join("NO_SKILL.md");
    fs::write(&no_frontmatter, "name: nope\n").expect("plain file should write");
    assert!(parse_skill_file(&no_frontmatter, "repo")
        .expect("plain file should parse")
        .is_none());

    let missing_name = root.join("missing-name.md");
    fs::write(&missing_name, "---\ndescription: Missing name.\n---\n")
        .expect("missing-name file should write");
    assert!(parse_skill_file(&missing_name, "repo")
        .expect("missing-name file should parse")
        .is_none());

    let missing_description = root.join("missing-description.md");
    fs::write(
        &missing_description,
        "---\nname: missing-description\n---\n",
    )
    .expect("missing-description file should write");
    assert!(parse_skill_file(&missing_description, "repo")
        .expect("missing-description file should parse")
        .is_none());
    assert!(parse_skill_file(&root.join("missing.md"), "repo").is_err());

    let content = "---\nname: demo\ndescription: test\n---\nbody\n";
    let parsed_frontmatter = frontmatter(content).expect("frontmatter should parse");
    assert_eq!(
        frontmatter_value(parsed_frontmatter, "name"),
        Some("demo".to_string())
    );
    assert_eq!(
        frontmatter_value("name: 'quoted'\ndescription: \"double\"", "description"),
        Some("double".to_string())
    );
    assert_eq!(frontmatter("name: demo\n"), None);
    assert_eq!(frontmatter_value("name: demo\n", "description"), None);

    let roots = skill_roots();
    assert!(roots
        .iter()
        .any(|path| path == Path::new("/etc/codex/skills")));
    assert_eq!(skill_source(Path::new("/etc/codex/skills")), "admin");
    assert_eq!(skill_source(&root), "repo");

    fs::remove_dir_all(root).expect("skill fixture should be removed");
}

#[test]
fn plugin_helpers_scan_parse_normalize_and_apply_config_overrides() {
    let root = temp_root("plugins");
    let cache_manifest = root
        .join("cache")
        .join("openai-bundled")
        .join("browser")
        .join("plugin.json");
    fs::create_dir_all(cache_manifest.parent().expect("cache manifest parent"))
        .expect("cache plugin dir should be created");
    fs::write(
        &cache_manifest,
        r#"{"id":"browser","interface":{"displayName":"Browser","shortDescription":" Use browser "}}"#,
    )
    .expect("cache manifest should write");

    let plugin = parse_plugin_manifest(&cache_manifest)
        .expect("cache plugin should parse")
        .expect("cache plugin should be present");
    assert_eq!(plugin.id, "browser@openai-bundled");
    assert_eq!(plugin.name, "Browser");
    assert!(plugin.enabled);
    assert_eq!(plugin.description.as_deref(), Some("Use browser"));
    assert_eq!(plugin.source.as_deref(), Some("openai-bundled"));

    let local_manifest = root
        .join(".codex")
        .join("plugins")
        .join("local")
        .join("plugin.json");
    fs::create_dir_all(local_manifest.parent().expect("local manifest parent"))
        .expect("local plugin dir should be created");
    fs::write(
        &local_manifest,
        r#"{"name":"local","displayName":"Local Plugin","description":"   ","enabled":false}"#,
    )
    .expect("local manifest should write");
    let local = parse_plugin_manifest(&local_manifest)
        .expect("local plugin should parse")
        .expect("local plugin should be present");
    assert_eq!(local.id, "local");
    assert_eq!(local.name, "Local Plugin");
    assert!(!local.enabled);
    assert_eq!(local.description, None);
    assert_eq!(local.source.as_deref(), Some("local"));

    let invalid_manifest = root.join("invalid-plugin.json");
    fs::write(&invalid_manifest, "{not json").expect("invalid manifest should write");
    assert!(parse_plugin_manifest(&invalid_manifest).is_err());
    assert_eq!(
        plugin_id_for_manifest(&cache_manifest, "browser@custom"),
        "browser@custom"
    );
    assert_eq!(
        plugin_id_for_manifest(&root.join("plugin.json"), "plain"),
        "plain"
    );
    assert_eq!(
        plugin_marketplace(&cache_manifest),
        Some("openai-bundled".to_string())
    );
    assert_eq!(
        plugin_marketplace(&root.join("plain").join("plugin.json")),
        None
    );
    assert_eq!(plugin_source(&local_manifest), Some("local".to_string()));
    assert_eq!(plugin_source(&root.join("plain").join("plugin.json")), None);
    assert_eq!(
        normalize_plugin_id(" browser ").expect("plugin id"),
        "browser"
    );
    assert!(normalize_plugin_id("   ").is_err());

    let parsed_enabled = parse_plugin_enabled_config(
        r#"
enabled = true
[plugins."browser@openai-bundled"]
name = "Browser"
enabled = true
[plugins."computer-use@openai-bundled"]
enabled = false
[plugins."ignored"]
enabled = maybe
[plugins."missing-equals"]
enabled true
[other]
enabled = false
"#,
    );
    assert_eq!(parsed_enabled.get("browser@openai-bundled"), Some(&true));
    assert_eq!(
        parsed_enabled.get("computer-use@openai-bundled"),
        Some(&false)
    );
    assert!(!parsed_enabled.contains_key("ignored"));
    assert!(!parsed_enabled.contains_key("missing-equals"));

    let scan_root = root.join("scan");
    let visible_dir = scan_root.join("visible").join("deep");
    let skipped_dir = scan_root.join("node_modules").join("hidden");
    fs::create_dir_all(&visible_dir).expect("visible scan dir should be created");
    fs::create_dir_all(&skipped_dir).expect("skipped scan dir should be created");
    fs::write(scan_root.join("plugin.json"), "{}").expect("root manifest should write");
    fs::write(visible_dir.join("plugin.json"), "{}").expect("nested manifest should write");
    fs::write(skipped_dir.join("plugin.json"), "{}").expect("skipped manifest should write");

    let mut manifests = Vec::new();
    collect_named_files(&scan_root, "plugin.json", 0, &mut manifests)
        .expect("zero-depth scan should succeed");
    assert!(manifests.is_empty());
    collect_named_files(&scan_root.join("missing"), "plugin.json", 4, &mut manifests)
        .expect("missing scan root should be ignored");
    let not_dir = scan_root.join("not-dir");
    fs::write(&not_dir, "not a dir").expect("not-dir fixture should write");
    collect_named_files(&not_dir, "plugin.json", 4, &mut manifests)
        .expect("file scan root should be ignored");
    collect_named_files(&scan_root, "plugin.json", 4, &mut manifests)
        .expect("plugin scan should succeed");
    assert!(manifests
        .iter()
        .any(|path| path == &scan_root.join("plugin.json")));
    assert!(manifests
        .iter()
        .any(|path| path == &visible_dir.join("plugin.json")));
    assert!(!manifests
        .iter()
        .any(|path| path == &skipped_dir.join("plugin.json")));

    fs::remove_dir_all(root).expect("plugin fixture should be removed");
}

fn temp_root(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "taskforceai-platform-{name}-{}-{nanos}",
        std::process::id()
    ))
}

fn restore_env(key: &str, value: Option<OsString>) {
    match value {
        Some(value) => std::env::set_var(key, value),
        None => std::env::remove_var(key),
    }
}
