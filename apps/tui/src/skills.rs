use std::collections::BTreeSet;

use taskforceai_app_client::AppServerClient;
use taskforceai_app_protocol::SkillRecord;

const MAX_SKILL_BYTES: u64 = 96 * 1024;
const MAX_TOTAL_SKILL_BYTES: usize = 160 * 1024;

pub(crate) async fn enrich_with_skills(client: &AppServerClient, request: String) -> String {
    let Ok(result) = client.skill_list().await else {
        return request;
    };
    enrich_with_available_skills(request, &result.skills).await
}

pub(crate) async fn enrich_with_available_skills(
    request: String,
    skills: &[SkillRecord],
) -> String {
    let enabled = skills
        .iter()
        .filter(|skill| skill.enabled)
        .cloned()
        .collect::<Vec<_>>();
    let selected = select_skills(&request, &enabled);
    if selected.is_empty() {
        return request;
    }

    let mut total = 0_usize;
    let mut bodies = Vec::new();
    for skill in selected {
        let Ok(metadata) = tokio::fs::metadata(&skill.path).await else {
            continue;
        };
        if !metadata.is_file() || metadata.len() > MAX_SKILL_BYTES {
            continue;
        }
        let Ok(body) = tokio::fs::read_to_string(&skill.path).await else {
            continue;
        };
        if total.saturating_add(body.len()) > MAX_TOTAL_SKILL_BYTES {
            break;
        }
        total += body.len();
        bodies.push(format!(
            "<skill name=\"{}\" path=\"{}\">\n{}\n</skill>",
            skill.name,
            skill.path,
            body.trim()
        ));
    }
    if bodies.is_empty() {
        request
    } else {
        format!(
            "Use the following selected skills for this request. Follow their instructions when they apply.\n<skills>\n{}\n</skills>\n\n{request}",
            bodies.join("\n\n")
        )
    }
}

fn select_skills<'a>(request: &str, skills: &'a [SkillRecord]) -> Vec<&'a SkillRecord> {
    let explicit = explicit_skill_names(request);
    let mut selected = skills
        .iter()
        .filter(|skill| explicit.contains(&skill.name.to_ascii_lowercase()))
        .collect::<Vec<_>>();
    if !selected.is_empty() {
        return selected;
    }

    let request_words = meaningful_words(request);
    let mut scored = skills
        .iter()
        .map(|skill| {
            let haystack = format!("{} {}", skill.name, skill.description);
            let score = meaningful_words(&haystack)
                .intersection(&request_words)
                .count();
            (skill, score)
        })
        .filter(|(_, score)| *score >= 2)
        .collect::<Vec<_>>();
    scored.sort_by(|(left, left_score), (right, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.name.cmp(&right.name))
    });
    selected.extend(scored.into_iter().take(1).map(|(skill, _)| skill));
    selected
}

fn explicit_skill_names(request: &str) -> BTreeSet<String> {
    request
        .split_whitespace()
        .filter_map(|token| token.strip_prefix('$'))
        .map(|name| {
            name.trim_matches(|character: char| {
                !character.is_alphanumeric() && character != '-' && character != '_'
            })
            .to_ascii_lowercase()
        })
        .filter(|name| !name.is_empty())
        .collect()
}

fn meaningful_words(value: &str) -> BTreeSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|word| word.len() >= 4)
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use taskforceai_app_client::AppServerClient;

    use super::*;
    use crate::test_support::start_rpc_sequence_server;

    fn skill(name: &str, description: &str) -> SkillRecord {
        SkillRecord {
            name: name.to_string(),
            description: description.to_string(),
            path: format!("/{name}/SKILL.md"),
            source: "test".to_string(),
            enabled: true,
        }
    }

    #[test]
    fn explicit_skill_wins_and_relevance_selects_one() {
        let skills = vec![
            skill("security-scan", "Audit repository security vulnerabilities"),
            skill("documents", "Create and edit Word documents"),
        ];
        assert_eq!(
            select_skills("Use $documents please", &skills)[0].name,
            "documents"
        );
        assert_eq!(
            select_skills("Audit repository security before release", &skills)[0].name,
            "security-scan"
        );
        assert!(select_skills("Say hello", &skills).is_empty());
    }

    #[tokio::test]
    async fn skill_enrichment_reads_valid_files_and_skips_invalid_candidates() {
        let temp = tempfile::tempdir().expect("tempdir");
        let valid = temp.path().join("valid.md");
        tokio::fs::write(&valid, "Follow this skill")
            .await
            .expect("valid skill");
        let oversized = temp.path().join("oversized.md");
        tokio::fs::write(&oversized, vec![b'x'; 97 * 1024])
            .await
            .expect("oversized skill");
        let invalid = temp.path().join("invalid.md");
        tokio::fs::write(&invalid, [0xff, 0xfe])
            .await
            .expect("invalid skill");
        let large_a = temp.path().join("large-a.md");
        let large_b = temp.path().join("large-b.md");
        tokio::fs::write(&large_a, "a".repeat(85 * 1024))
            .await
            .expect("large a");
        tokio::fs::write(&large_b, "b".repeat(85 * 1024))
            .await
            .expect("large b");

        let records = vec![
            SkillRecord {
                path: valid.to_string_lossy().into_owned(),
                ..skill("valid", "valid workflow")
            },
            SkillRecord {
                path: oversized.to_string_lossy().into_owned(),
                ..skill("oversized", "oversized workflow")
            },
            SkillRecord {
                path: invalid.to_string_lossy().into_owned(),
                ..skill("invalid", "invalid workflow")
            },
            SkillRecord {
                path: temp
                    .path()
                    .join("missing.md")
                    .to_string_lossy()
                    .into_owned(),
                ..skill("missing", "missing workflow")
            },
            SkillRecord {
                path: large_a.to_string_lossy().into_owned(),
                ..skill("large-a", "large first")
            },
            SkillRecord {
                path: large_b.to_string_lossy().into_owned(),
                ..skill("large-b", "large second")
            },
        ];
        let enriched = enrich_with_available_skills(
            "Use $valid $oversized $invalid $missing".to_string(),
            &records,
        )
        .await;
        assert!(enriched.contains("Follow this skill"));
        assert!(!enriched.contains("oversized workflow"));

        let unchanged = enrich_with_available_skills("hello".to_string(), &records).await;
        assert_eq!(unchanged, "hello");
        let missing_only = enrich_with_available_skills("Use $missing".to_string(), &records).await;
        assert_eq!(missing_only, "Use $missing");

        let bounded =
            enrich_with_available_skills("Use $large-a $large-b".to_string(), &records).await;
        assert!(bounded.contains(&"a".repeat(100)));
        assert!(!bounded.contains(&"b".repeat(100)));

        let (base_url, server) = start_rpc_sequence_server(vec![(
            "skill.list",
            json!({"skills": [{
                "name": "valid",
                "description": "valid workflow",
                "path": valid,
                "source": "test",
                "enabled": true
            }], "truncated": false}),
        )]);
        let client = AppServerClient::connect_http(base_url, "token").expect("client");
        let enriched = enrich_with_skills(&client, "Use $valid".to_string()).await;
        assert!(enriched.contains("Follow this skill"));
        server.join().expect("server");

        let client = AppServerClient::connect_http("http://127.0.0.1:1", "token")
            .expect("client construction");
        assert_eq!(
            enrich_with_skills(&client, "unchanged".to_string()).await,
            "unchanged"
        );

        let tied = vec![
            skill("z-security", "audit repository security"),
            skill("a-security", "audit repository security"),
        ];
        assert_eq!(
            select_skills("audit repository security", &tied)[0].name,
            "a-security"
        );
    }
}
