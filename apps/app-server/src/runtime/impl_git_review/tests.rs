#[cfg(test)]
mod pull_request_tests {
    use std::fs;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static TEST_SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn parse_pull_request_json_summarizes_github_context() {
        let raw = br#"{
          "number": 42,
          "title": "Wire desktop review pane",
          "url": "https://github.com/taskforceai/taskforceai/pull/42",
          "state": "OPEN",
          "headRefName": "codex/review-pane",
          "baseRefName": "main",
          "isDraft": false,
          "reviewDecision": "CHANGES_REQUESTED",
          "comments": [{ "body": "thread note" }],
          "files": [{ "path": "apps/desktop/src/main.rs" }],
          "latestReviews": [
            {
              "author": { "login": "reviewer" },
              "state": "CHANGES_REQUESTED",
              "submittedAt": "2026-07-04T12:00:00Z",
              "body": "Please tighten the tests."
            }
          ]
        }"#;

        let pull_request = parse_pull_request_json(raw).expect("pull request should parse");

        assert_eq!(pull_request.number, 42);
        assert_eq!(pull_request.title, "Wire desktop review pane");
        assert_eq!(
            pull_request.review_decision.as_deref(),
            Some("CHANGES_REQUESTED")
        );
        assert_eq!(pull_request.comment_count, 1);
        assert_eq!(pull_request.review_count, 1);
        assert_eq!(pull_request.changed_file_count, 1);
        assert_eq!(
            pull_request.latest_reviews[0].author.as_deref(),
            Some("reviewer")
        );
    }

    #[test]
    fn git_review_helpers_cover_parsing_and_synthetic_diff_edges() {
        assert!(parse_status_line("??").is_none());
        let renamed =
            parse_name_status_line("R100\told.txt\tnew.txt").expect("rename status should parse");
        assert_eq!(renamed.path, "new.txt");
        assert_eq!(renamed.old_path.as_deref(), Some("old.txt"));
        assert_eq!(renamed.status, "R100");
        assert_eq!(
            parse_name_status_line("M changed.txt")
                .expect("whitespace status should parse")
                .path,
            "changed.txt"
        );

        let long_review = format!("{}🧪", "a".repeat(499));
        let truncated = truncate_review_body(&long_review);
        assert!(truncated.ends_with("..."));
        assert!(truncated.is_char_boundary(truncated.len()));

        let binary = synthetic_untracked_file_diff("binary.dat", "100644", b"a\0b");
        assert!(String::from_utf8_lossy(&binary).contains("Binary files"));
        let empty = synthetic_untracked_file_diff("empty.txt", "100644", b"");
        assert!(!String::from_utf8_lossy(&empty).contains("@@"));

        let root = test_root("synthetic-edges");
        fs::write(root.join("note.txt"), "note\n").expect("write note");
        let mut output = b"existing".to_vec();
        append_untracked_diffs(
            &root,
            &[
                "../unsafe".to_string(),
                "missing.txt".to_string(),
                "note.txt".to_string(),
            ],
            &mut output,
        );
        let rendered = String::from_utf8_lossy(&output);
        assert!(rendered.starts_with("existing\n"));
        assert!(rendered.contains("diff --git a/note.txt"));
        assert!(synthetic_untracked_diff(&root, ".").is_empty());

        let mut files = vec![GitReviewDiffFile {
            path: "note.txt".to_string(),
            old_path: None,
            status: "M".to_string(),
        }];
        append_untracked_files(&mut files, &["note.txt".to_string(), "new.txt".to_string()]);
        assert_eq!(files.len(), 2);
        assert!(fuzzy_path_matches("docs/readme.md", "readme"));
        let mut paths = BTreeSet::new();
        collect_paths_from_value(
            &serde_json::json!({
                "files": [{"path": "src/main.rs"}, {"other": true}],
                "filePath": ["src/lib.rs", "../unsafe"],
                "ignored": 7
            }),
            None,
            &mut paths,
        );
        assert_eq!(
            paths.into_iter().collect::<Vec<_>>(),
            vec!["src/lib.rs", "src/main.rs"]
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn git_review_helpers_cover_refs_empty_repositories_and_command_errors() {
        let repo = initialized_repo("refs", "topic");
        assert_eq!(
            select_base_ref(&repo, Some(" HEAD "), None).expect("HEAD should resolve"),
            Some("HEAD".to_string())
        );
        assert!(select_base_ref(&repo, Some("missing-ref"), None).is_err());
        assert_eq!(
            select_base_ref(&repo, None, None).expect("fallbacks should resolve"),
            None
        );

        let file = repo.join("not-a-directory");
        fs::write(&file, "file").expect("write file");
        assert!(resolve_workspace(file.to_str()).is_err());

        assert_eq!(
            git_optional_output(&repo, &["diff", "--quiet"])
                .expect("empty output should be accepted"),
            None
        );
        assert!(git_output(&repo, &["definitely-not-a-git-command"]).is_err());
        assert!(git_output_bytes(&repo, &["definitely-not-a-git-command"]).is_err());
        assert!(git_error(&["status"], b"")
            .message
            .contains("git status failed"));

        let empty_repo = test_root("empty-repo");
        run_git(&empty_repo, &["init", "-b", "topic"]);
        fs::write(empty_repo.join("staged.txt"), "staged\n").expect("write staged");
        run_git(&empty_repo, &["add", "staged.txt"]);
        fs::write(empty_repo.join("unstaged.txt"), "unstaged\n").expect("write unstaged");

        let bytes = diff_bytes_for_scope(&empty_repo, GitReviewScope::Uncommitted, None, &[])
            .expect("unborn diff bytes should load");
        assert!(String::from_utf8_lossy(&bytes).contains("staged"));
        let files = diff_files_for_scope(&empty_repo, GitReviewScope::Uncommitted, None, &[])
            .expect("unborn diff files should load");
        assert!(files.iter().any(|file| file.path == "staged.txt"));
        fs::write(empty_repo.join("staged.txt"), "staged and changed\n")
            .expect("modify staged file");
        assert!(!diff_bytes_for_scope(
            &empty_repo,
            GitReviewScope::LastTurn,
            None,
            &["staged.txt".to_string()],
        )
        .expect("unborn last-turn bytes")
        .is_empty());
        assert_eq!(
            diff_files_for_scope(
                &empty_repo,
                GitReviewScope::LastTurn,
                None,
                &["staged.txt".to_string()],
            )
            .expect("unborn last-turn files")[0]
                .path,
            "staged.txt"
        );
        assert!(
            diff_bytes_for_scope(&repo, GitReviewScope::AllBranchChanges, None, &[])
                .expect("missing base should be empty")
                .is_empty()
        );
        assert!(
            diff_files_for_scope(&repo, GitReviewScope::AllBranchChanges, None, &[])
                .expect("missing base should be empty")
                .is_empty()
        );
        assert!(
            diff_bytes_for_scope(&repo, GitReviewScope::AllBranchChanges, Some("HEAD"), &[])
                .expect("branch diff bytes should load")
                .is_empty()
        );
        assert!(
            diff_files_for_scope(&repo, GitReviewScope::AllBranchChanges, Some("HEAD"), &[])
                .expect("branch diff files should load")
                .is_empty()
        );

        fs::remove_dir_all(repo).ok();
        fs::remove_dir_all(empty_repo).ok();
    }

    #[test]
    fn git_review_diff_truncates_large_untracked_content() {
        let repo = initialized_repo("truncation", "topic");
        fs::write(repo.join("large.txt"), "x".repeat(4096)).expect("write large file");

        let result = git_review_diff_result(
            GitReviewDiffParams {
                workspace: Some(repo.display().to_string()),
                scope: GitReviewScope::Uncommitted,
                base_ref: None,
                max_bytes: Some(1024),
                thread_id: None,
            },
            &[],
        )
        .expect("diff should load");

        assert!(result.truncated);
        assert_eq!(result.raw_diff.len(), 1024);
        assert!(result.files.iter().any(|file| file.path == "large.txt"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pull_request_command_output_requires_success() {
        let raw = br#"{
          "number": 7,
          "title": "Review",
          "url": "https://github.com/taskforceai/taskforceai/pull/7"
        }"#;

        assert!(parse_pull_request_command_output(false, raw).is_none());
        assert_eq!(
            parse_pull_request_command_output(true, raw)
                .expect("successful output should parse")
                .number,
            7
        );
    }

    #[test]
    fn workspace_file_read_is_bounded_and_rejects_traversal() {
        let repo = initialized_repo("workspace-read", "topic");
        fs::write(repo.join("preview.txt"), "abcdef").expect("write preview");

        let result = workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(repo.display().to_string()),
            path: "preview.txt".to_string(),
            max_bytes: Some(4),
        })
        .expect("workspace file should load");
        assert_eq!(result.content, "abcd");
        assert!(result.truncated);
        assert!(!result.binary);

        let traversal = workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(repo.display().to_string()),
            path: "../outside.txt".to_string(),
            max_bytes: None,
        })
        .expect_err("parent traversal must fail");
        assert_eq!(traversal.code, -32602);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn review_comments_validate_round_trip_and_resolve() {
        let repo = initialized_repo("comments", "topic");
        let mut runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        for (line, end_line, body) in [
            (0, None, "body".to_string()),
            (2, Some(1), "body".to_string()),
            (1, None, " ".to_string()),
            (1, None, "x".repeat(8_001)),
        ] {
            assert!(runtime
                .git_review_comment_add(GitReviewCommentAddParams {
                    workspace: Some(repo.display().to_string()),
                    path: "tracked.txt".to_string(),
                    line,
                    end_line,
                    body,
                })
                .is_err());
        }

        let added = runtime
            .git_review_comment_add(GitReviewCommentAddParams {
                workspace: Some(repo.display().to_string()),
                path: "tracked.txt".to_string(),
                line: 1,
                end_line: Some(1),
                body: " Check this line ".to_string(),
            })
            .expect("add review comment");
        let AppResponse::Value(added) = added else {
            panic!("expected value response"); // coverage:ignore-line -- infallible response shape assertion.
        };
        let comment_id = added["comment"]["id"]
            .as_str()
            .expect("comment id")
            .to_string();
        let listed = runtime
            .git_review_comment_list(GitReviewCommentListParams {
                workspace: Some(repo.display().to_string()),
            })
            .expect("list review comments");
        let AppResponse::Value(listed) = listed else {
            panic!("expected value response"); // coverage:ignore-line -- infallible response shape assertion.
        };
        assert_eq!(listed["comments"].as_array().expect("comments").len(), 1);
        runtime
            .git_review_comment_resolve(GitReviewCommentResolveParams {
                comment_id,
                resolved: true,
            })
            .expect("resolve comment");
        assert!(runtime
            .git_review_comment_resolve(GitReviewCommentResolveParams {
                comment_id: "missing".to_string(),
                resolved: true,
            })
            .is_err());
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn stage_and_last_turn_validation_cover_unborn_repository_paths() {
        let root = test_root("unborn-stage");
        run_git(&root, &["init", "-b", "topic"]);
        fs::write(root.join("new.txt"), "new\n").expect("write new file");
        let runtime = crate::runtime::AppRuntime::new(crate::runtime::RuntimeConfig::default());
        runtime
            .git_review_stage(GitReviewStageParams {
                workspace: Some(root.display().to_string()),
                paths: vec!["new.txt".to_string()],
                staged: true,
            })
            .expect("stage file");
        runtime
            .git_review_stage(GitReviewStageParams {
                workspace: Some(root.display().to_string()),
                paths: vec!["new.txt".to_string()],
                staged: false,
            })
            .expect("unstage unborn file");
        assert!(runtime
            .git_review_diff(GitReviewDiffParams {
                workspace: Some(root.display().to_string()),
                scope: GitReviewScope::LastTurn,
                base_ref: None,
                max_bytes: None,
                thread_id: None,
            })
            .is_err());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn workspace_disk_listing_binary_reads_and_path_helpers_cover_edges() {
        let root = test_root("workspace-disk");
        fs::create_dir_all(root.join("src/nested")).expect("create nested directory");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("create ignored directory");
        fs::write(root.join("src/nested/alpha.rs"), "fn alpha() {}\n").expect("write source");
        fs::write(root.join("binary.dat"), [0xff, 0xfe]).expect("write binary");
        fs::write(root.join("node_modules/pkg/ignored.js"), "ignored").expect("write ignored");

        let listed = workspace_file_list_result(WorkspaceFileListParams {
            workspace: Some(root.display().to_string()),
            query: Some("snar".to_string()),
            limit: Some(10),
        })
        .expect("list disk files");
        assert_eq!(listed.files, vec!["src/nested/alpha.rs"]);
        let binary = workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(root.display().to_string()),
            path: "binary.dat".to_string(),
            max_bytes: None,
        })
        .expect("read binary");
        assert!(binary.binary);
        assert!(binary.content.is_empty());
        assert!(workspace_file_read_result(WorkspaceFileReadParams {
            workspace: Some(root.display().to_string()),
            path: "src".to_string(),
            max_bytes: None,
        })
        .is_err());

        assert!(validate_git_paths(&[]).is_err());
        assert!(validate_git_paths(&vec!["file".to_string(); 201]).is_err());
        for unsafe_path in ["../outside", ".git", ".git/config", "/absolute"] {
            assert!(validate_git_paths(&[unsafe_path.to_string()]).is_err());
        }
        assert_eq!(
            validate_git_paths(&[" a.rs ".to_string(), "a.rs".to_string()])
                .expect("deduplicate paths"),
            vec!["a.rs"]
        );
        assert!(fuzzy_path_matches("src/nested/alpha.rs", "snar"));
        assert!(!fuzzy_path_matches("src/nested/alpha.rs", "zzz"));
        assert_eq!(path_match_rank("readme.md", Some("readme.md")).0, 0);
        assert_eq!(path_match_rank("docs/readme.md", Some("readme.md")).0, 1);
        assert_eq!(path_match_rank("docs/readme.md", Some("readme")).0, 2);
        assert_eq!(path_match_rank("docs/readme.md", Some("drm")).0, 3);
        assert_eq!(path_match_rank("docs/readme.md", None).0, 0);
        let repo = initialized_repo("workspace-git-list", "topic");
        let listed = workspace_file_list_result(WorkspaceFileListParams {
            workspace: Some(repo.display().to_string()),
            query: None,
            limit: None,
        })
        .expect("list Git workspace");
        assert!(listed.files.iter().any(|path| path == "tracked.txt"));
        fs::remove_dir_all(repo).ok();
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn last_turn_diff_and_command_helpers_cover_empty_and_failure_results() {
        let repo = initialized_repo("last-turn", "topic");
        assert!(
            diff_bytes_for_scope(&repo, GitReviewScope::LastTurn, None, &[])
                .expect("empty last-turn bytes")
                .is_empty()
        );
        assert!(
            diff_files_for_scope(&repo, GitReviewScope::LastTurn, None, &[])
                .expect("empty last-turn files")
                .is_empty()
        );
        fs::write(repo.join("tracked.txt"), "changed\n").expect("change tracked file");
        assert!(!diff_bytes_for_scope(
            &repo,
            GitReviewScope::LastTurn,
            None,
            &["tracked.txt".to_string()],
        )
        .expect("last-turn bytes")
        .is_empty());
        assert_eq!(
            diff_files_for_scope(
                &repo,
                GitReviewScope::LastTurn,
                None,
                &["tracked.txt".to_string()],
            )
            .expect("last-turn files")[0]
                .path,
            "tracked.txt"
        );
        assert_eq!(
            command_output_owned("true", &repo, &[]).expect("true command"),
            ""
        );
        assert!(command_output_owned("false", &repo, &[]).is_err());
        assert!(
            command_output_owned("definitely-missing-taskforceai-command", &repo, &[]).is_err()
        );
        assert!(git_output_owned(&repo, &["definitely-not-a-command".to_string()]).is_err());
        assert!(git_output_owned_bytes(&repo, &["definitely-not-a-command".to_string()]).is_err());
        assert!(command_error("tool", &[], b"")
            .message
            .contains("tool  failed"));
        assert!(command_error("tool", &["arg".to_string()], b"detail")
            .message
            .contains("detail"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn pull_request_arguments_messages_and_comment_ids_are_deterministic() {
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::MarkReady, None)
                .expect("mark ready args"),
            vec!["pr", "ready"]
        );
        assert!(git_pull_request_args(GitReviewPullRequestAction::Comment, None).is_err());
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::Comment, Some("note"))
                .expect("comment args"),
            vec!["pr", "review", "--comment", "--body", "note"]
        );
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::Approve, None).expect("approve args"),
            vec!["pr", "review", "--approve"]
        );
        assert_eq!(
            git_pull_request_args(GitReviewPullRequestAction::Approve, Some("looks good"))
                .expect("approve body args"),
            vec!["pr", "review", "--approve", "--body", "looks good"]
        );
        assert!(git_pull_request_args(GitReviewPullRequestAction::RequestChanges, None).is_err());
        assert_eq!(
            git_pull_request_args(
                GitReviewPullRequestAction::RequestChanges,
                Some("please fix"),
            )
            .expect("request changes args"),
            vec!["pr", "review", "--request-changes", "--body", "please fix"]
        );
        assert_eq!(
            git_review_action_message("  "),
            "Pull request action completed."
        );
        assert_eq!(git_review_action_message(" done \n"), "done");

        let comment = |id: &str| GitReviewCommentRecord {
            id: id.to_string(),
            workspace: "/tmp".to_string(),
            path: "file".to_string(),
            line: 1,
            end_line: None,
            body: "body".to_string(),
            resolved: false,
            created_at: 10,
            updated_at: 10,
        };
        assert_eq!(unique_review_comment_id(&[], 10), "review-comment-10");
        assert_eq!(
            unique_review_comment_id(
                &[comment("review-comment-10"), comment("review-comment-10-2")],
                10,
            ),
            "review-comment-10-3"
        );
    }

    fn initialized_repo(label: &str, branch: &str) -> PathBuf {
        let root = test_root(label);
        run_git(&root, &["init", "-b", branch]);
        run_git(&root, &["config", "user.email", "review@example.invalid"]);
        run_git(&root, &["config", "user.name", "Review Test"]);
        fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked");
        run_git(&root, &["add", "tracked.txt"]);
        run_git(&root, &["commit", "-m", "initial"]);
        root
    }

    fn test_root(label: &str) -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "taskforceai-git-review-helper-{label}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn run_git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("git should execute");
        // coverage:ignore-start -- only formats diagnostics when a test fixture command fails.
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        // coverage:ignore-end
    }
}
