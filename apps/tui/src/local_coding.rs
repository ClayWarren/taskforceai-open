use std::path::{Path, PathBuf};

use taskforceai_app_client::{local_coding, AppClientError, AppServerClient};

pub async fn enable_workspace_tools(
    client: &mut AppServerClient,
    workspace: impl AsRef<Path>,
) -> Result<PathBuf, AppClientError> {
    Ok(
        local_coding::enable_workspace_tools_for_launch_directory_with_handle(
            &client.request_handle(),
            workspace,
        )
        .await?
        .workspace,
    )
}

pub fn default_workspace() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn contextualize_prompt(workspace: Option<&str>, request: &str) -> String {
    workspace.map_or_else(
        || request.to_string(),
        |workspace| local_coding::prompt_for_workspace(Path::new(workspace), request),
    )
}

pub fn local_runs_allowed() -> bool {
    std::env::var("TASKFORCEAI_ALLOW_LOCAL_RUNS")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

pub(crate) fn format_workspace_mention(path: &str) -> String {
    if path.chars().any(char::is_whitespace) || path.contains(['\\', '}']) {
        let escaped = path.replace('\\', "\\\\").replace('}', "\\}");
        format!("@{{{escaped}}}")
    } else {
        format!("@{path}")
    }
}

pub(crate) fn workspace_mention_paths(prompt: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut search_from = 0;
    while let Some(relative_at) = prompt[search_from..].find('@') {
        let at = search_from + relative_at;
        let boundary = at == 0
            || prompt[..at]
                .chars()
                .next_back()
                .is_some_and(char::is_whitespace);
        if !boundary {
            search_from = at + 1;
            continue;
        }
        let rest = &prompt[at + 1..];
        if let Some(braced) = rest.strip_prefix('{') {
            let mut path = String::new();
            let mut escaped = false;
            let mut consumed = None;
            for (offset, character) in braced.char_indices() {
                if escaped {
                    path.push(character);
                    escaped = false;
                } else if character == '\\' {
                    escaped = true;
                } else if character == '}' {
                    consumed = Some(offset + character.len_utf8());
                    break;
                } else {
                    path.push(character);
                }
            }
            if let Some(consumed) = consumed {
                if !path.is_empty() {
                    paths.push(path);
                }
                search_from = at + 2 + consumed;
                continue;
            }
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let path = rest[..end]
                .trim_matches(|character: char| matches!(character, ',' | ';' | ':' | ')' | ']'))
                .to_string();
            if !path.is_empty() {
                paths.push(path);
            }
            search_from = at + 1 + end;
            continue;
        }
        search_from = at + 1;
    }
    paths
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{
        contextualize_prompt, default_workspace, format_workspace_mention, workspace_mention_paths,
    };

    #[test]
    fn default_workspace_uses_current_directory() {
        assert!(default_workspace().is_absolute() || default_workspace() == Path::new("."));
    }

    #[test]
    fn contextualized_prompt_names_the_tui_launch_directory() {
        let prompt = contextualize_prompt(Some("/Users/example"), "Where am I?");

        assert!(prompt.contains("- `/Users/example`"));
        assert!(prompt.ends_with("User request:\nWhere am I?"));
        assert_eq!(contextualize_prompt(None, "Plain"), "Plain");
    }

    #[test]
    fn workspace_mentions_round_trip_paths_with_spaces_and_braces() {
        let path = "docs/road map}.md";
        let mention = format_workspace_mention(path);
        assert_eq!(mention, "@{docs/road map\\}.md}");
        assert_eq!(
            workspace_mention_paths(&format!("Review {mention}")),
            [path]
        );
        assert_eq!(
            workspace_mention_paths("email@example.com @src/app.rs,"),
            ["src/app.rs"]
        );
        assert!(workspace_mention_paths("Review @{unterminated").is_empty());
    }
}
