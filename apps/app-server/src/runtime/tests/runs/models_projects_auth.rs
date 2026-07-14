use super::*;

#[tokio::test]
async fn command_execute_sets_default_model_for_submitted_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let model = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/model set zai/glm-5.2".to_string(),
            })
            .await
            .expect("model command should succeed"),
    );
    assert_eq!(model["handled"], true);

    let response = runtime
        .run_submit(submit_run_params("use default model"))
        .await
        .expect("submit should succeed");
    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["modelId"], "zai/glm-5.2");
}

#[tokio::test]
async fn model_methods_manage_shared_selector_state() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let list = result_value(runtime.model_list().await.expect("model list should work"));

    assert_eq!(list["enabled"], true);
    assert_eq!(list["remoteCatalog"], false);
    assert!(
        list["options"]
            .as_array()
            .expect("models should list")
            .len()
            >= 3
    );

    let selected = result_value(
        runtime
            .model_select(ModelSelectParams {
                model_id: "gpt-5".to_string(),
            })
            .await
            .expect("model select should work"),
    );
    assert_eq!(selected["selectedModelId"], "gpt-5");

    let reset = result_value(
        runtime
            .model_reset()
            .await
            .expect("model reset should work"),
    );
    assert_eq!(reset["selectedModelId"], serde_json::Value::Null);
}

#[tokio::test]
async fn project_use_sets_default_project_for_submitted_runs() {
    let mut runtime = AppRuntime::new(RuntimeConfig::default());
    let selected = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project use 42".to_string(),
            })
            .await
            .expect("project command should succeed"),
    );
    assert_eq!(selected["handled"], true);

    let response = runtime
        .run_submit(submit_run_params("use active project"))
        .await
        .expect("submit should succeed");
    let AppResponse::WithEvents { result, .. } = response else {
        panic!("expected response with events");
    };
    assert_eq!(result["run"]["projectId"], 42);

    let cleared = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project clear".to_string(),
            })
            .await
            .expect("project clear should succeed"),
    );
    assert_eq!(cleared["handled"], true);
    assert_eq!(
        runtime
            .active_project_id()
            .expect("active project should parse"),
        None
    );
}

#[tokio::test]
async fn project_methods_cover_local_empty_auth_and_remote_api_flows() {
    let mut local_runtime = AppRuntime::new(RuntimeConfig::default());
    local_runtime
        .project_use(ProjectIDParams { project_id: 77 })
        .expect("project use should persist active id");
    let unauthenticated = result_value(
        local_runtime
            .project_list()
            .await
            .expect("unauthenticated project list should be empty"),
    );
    assert_eq!(unauthenticated["activeProjectId"], 77);
    assert_eq!(
        unauthenticated["projects"]
            .as_array()
            .expect("projects should be an array")
            .len(),
        0
    );
    let empty_name = local_runtime
        .project_create(ProjectCreateParams {
            name: "   ".to_string(),
            description: None,
            custom_instructions: None,
            workspace_roots: Vec::new(),
        })
        .await
        .expect_err("empty project name should fail");
    assert_eq!(empty_name.code, -32602);
    let invalid_id = local_runtime
        .project_use(ProjectIDParams { project_id: 0 })
        .expect_err("zero project id should fail");
    assert_eq!(invalid_id.code, -32602);
    let unauth_create = local_runtime
        .project_create(ProjectCreateParams {
            name: "No Auth".to_string(),
            description: None,
            custom_instructions: None,
            workspace_roots: Vec::new(),
        })
        .await
        .expect_err("project create should require auth");
    assert_eq!(unauth_create.code, -32010);
    let unauth_delete = local_runtime
        .project_delete(ProjectIDParams { project_id: 77 })
        .await
        .expect_err("project delete should require auth");
    assert_eq!(unauth_delete.code, -32010);

    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!([
                {
                    "id": 12,
                    "name": "Research",
                    "description": "Lab work",
                    "customInstructions": "Be precise",
                    "createdAt": "2026-01-02T03:04:05Z"
                }
            ])
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "id": 13,
                "name": "New Project",
                "description": "Drafts",
                "customInstructions": "Ship tests",
                "createdAt": "2026-02-03T04:05:06Z"
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response("{}".to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime
        .project_use(ProjectIDParams { project_id: 12 })
        .expect("active project should persist");
    runtime
        .project_workspace_set(ProjectWorkspaceSetParams {
            project_id: 12,
            workspace_roots: vec![" /tmp/research ".to_string(), "/tmp/research".to_string()],
        })
        .expect("project workspace should persist");

    let listed = result_value(
        runtime
            .project_list()
            .await
            .expect("project list should work"),
    );
    assert_eq!(listed["activeProjectId"], 12);
    assert_eq!(listed["projects"][0]["name"], "Research");
    assert_eq!(
        listed["projects"][0]["workspaceRoots"],
        json!(["/tmp/research"])
    );
    let created = result_value(
        runtime
            .project_create(ProjectCreateParams {
                name: "  New Project  ".to_string(),
                description: Some("Drafts".to_string()),
                custom_instructions: Some("Ship tests".to_string()),
                workspace_roots: vec!["/tmp/new-project".to_string()],
            })
            .await
            .expect("project create should work"),
    );
    assert_eq!(created["project"]["id"], 13);
    assert_eq!(created["project"]["name"], "New Project");
    assert_eq!(
        created["project"]["workspaceRoots"],
        json!(["/tmp/new-project"])
    );
    let deleted = result_value(
        runtime
            .project_delete(ProjectIDParams { project_id: 12 })
            .await
            .expect("project delete should work"),
    );
    assert_eq!(deleted["ok"], true);
    let workspaces = runtime
        .metadata_json::<std::collections::BTreeMap<i64, Vec<String>>>(
            crate::runtime::PROJECT_WORKSPACES_METADATA_KEY,
        )
        .expect("workspace metadata should parse")
        .expect("workspace metadata should exist");
    assert!(!workspaces.contains_key(&12));
    assert_eq!(
        workspaces.get(&13),
        Some(&vec!["/tmp/new-project".to_string()])
    );
    assert_eq!(
        runtime
            .active_project_id()
            .expect("active project should parse"),
        None
    );

    server.join().expect("mock project server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/projects");
    assert_eq!(requests[2].method, "POST");
    assert_eq!(requests[2].path, "/projects");
    let create_body: Value =
        serde_json::from_str(&requests[2].body).expect("create body should be json");
    assert_eq!(create_body["name"], "New Project");
    assert_eq!(requests[4].method, "DELETE");
    assert_eq!(requests[4].path, "/projects/12");
}

#[tokio::test]
async fn project_command_covers_status_create_delete_and_usage() {
    let mut local_runtime = AppRuntime::new(RuntimeConfig::default());
    let local_status = result_value(
        local_runtime
            .command_execute(CommandExecuteParams {
                input: "/project status".to_string(),
            })
            .await
            .expect("local project status should work"),
    );
    assert!(local_status["message"]
        .as_str()
        .expect("message should be string")
        .contains("No remote projects available"));
    let missing_create_name = result_value(
        local_runtime
            .command_execute(CommandExecuteParams {
                input: "/project create".to_string(),
            })
            .await
            .expect("missing project create name returns usage"),
    );
    assert_eq!(missing_create_name["handled"], false);
    let bad_use = local_runtime
        .command_execute(CommandExecuteParams {
            input: "/project use nope".to_string(),
        })
        .await
        .expect_err("bad project id should fail");
    assert!(bad_use.message.contains("project id must be an integer"));
    let unknown = result_value(
        local_runtime
            .command_execute(CommandExecuteParams {
                input: "/project wat".to_string(),
            })
            .await
            .expect("unknown project command should return usage"),
    );
    assert_eq!(unknown["handled"], false);

    let (base_url, server, requests) = start_recording_response_sequence_server(vec![
        json_response(
            json!([
                {
                    "id": 21,
                    "name": "Ops",
                    "description": null,
                    "customInstructions": null,
                    "createdAt": "2026-03-04T05:06:07Z"
                }
            ])
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response(
            json!({
                "id": 22,
                "name": "New Ops",
                "description": null,
                "customInstructions": null,
                "createdAt": "2026-03-05T06:07:08Z"
            })
            .to_string(),
        ),
        MockHttpResponse {
            body: json!({ "csrfToken": "test-csrf" }).to_string(),
            headers: vec![("Set-Cookie", "csrf_token=test-csrf; Path=/")],
        },
        json_response("{}".to_string()),
    ]);
    let mut runtime = AppRuntime::new(RuntimeConfig {
        api_base_url: base_url,
        ..RuntimeConfig::default()
    });
    set_auth_token(&mut runtime, "token");
    runtime
        .project_use(ProjectIDParams { project_id: 21 })
        .expect("active project should persist");

    let remote_status = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/projects ls".to_string(),
            })
            .await
            .expect("remote project list command should work"),
    );
    assert!(remote_status["message"]
        .as_str()
        .expect("message should be string")
        .contains("* 21: Ops"));
    let created = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project create New Ops".to_string(),
            })
            .await
            .expect("project create command should work"),
    );
    assert_eq!(created["message"], "Created project 22: New Ops");
    let deleted = result_value(
        runtime
            .command_execute(CommandExecuteParams {
                input: "/project delete 22".to_string(),
            })
            .await
            .expect("project delete command should work"),
    );
    assert_eq!(deleted["message"], "Deleted project 22.");

    server
        .join()
        .expect("mock project command server should exit");
    let requests = requests.lock().expect("requests should be recorded");
    assert_eq!(requests[0].path, "/projects");
    assert_eq!(requests[2].path, "/projects");
    assert_eq!(requests[4].path, "/projects/22");
}
