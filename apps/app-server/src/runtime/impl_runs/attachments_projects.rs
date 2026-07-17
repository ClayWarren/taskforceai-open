use super::*;

impl super::super::AppRuntime {
    pub fn attachment_list(&self) -> AppResponse {
        value(AttachmentListResult {
            attachments: self.active_attachments.clone(),
            max_attachments: MAX_PENDING_ATTACHMENTS,
        })
    }

    pub async fn attachment_add(
        &mut self,
        params: AttachmentAddParams,
    ) -> Result<AppResponse, RuntimeError> {
        if self.active_attachments.len() >= MAX_PENDING_ATTACHMENTS {
            return Err(RuntimeError::invalid_params(format!(
                "attachment limit reached ({MAX_PENDING_ATTACHMENTS})"
            )));
        }
        let path = expand_user_path(params.path.trim());
        if path.as_os_str().is_empty() {
            return Err(RuntimeError::invalid_params("attachment path is required"));
        }
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required to upload attachments"))?;
        let metadata = tokio::fs::metadata(&path).await?;
        if !metadata.is_file() {
            return Err(RuntimeError::invalid_params(
                "attachment path must reference a regular file",
            ));
        }
        if metadata.len() > MAX_VIDEO_SIZE as u64 {
            return Err(RuntimeError::invalid_params(format!(
                "attachment too large ({} bytes); maximum is {} MB",
                metadata.len(),
                MAX_VIDEO_SIZE / (1024 * 1024)
            )));
        }
        let data = tokio::fs::read(&path).await?;
        let mime_type = detect_attachment_mime_type(&path, &data);
        let limit = attachment_size_limit(&mime_type);
        if data.len() > limit {
            return Err(RuntimeError::invalid_params(format!(
                "attachment too large ({} bytes); maximum is {} MB",
                data.len(),
                limit / (1024 * 1024)
            )));
        }
        if !allowed_attachment_mime_type(&mime_type) {
            return Err(RuntimeError::invalid_params(format!(
                "unsupported attachment type: {mime_type}"
            )));
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
            .to_string();
        let uploaded = self
            .api_client
            .upload_attachment(&token, &name, data)
            .await
            .map_err(|err| RuntimeError::network(format!("attachment upload failed: {err}")))?;
        let attachment = AttachmentRecord {
            id: uploaded.id,
            name,
            path: path.display().to_string(),
            mime_type: uploaded.mime_type,
            size: uploaded.size,
        };
        self.active_attachments.push(attachment.clone());
        Ok(value(AttachmentAddResult {
            attachment,
            attachments: self.active_attachments.clone(),
            max_attachments: MAX_PENDING_ATTACHMENTS,
        }))
    }

    pub fn attachment_clear(&mut self) -> AppResponse {
        self.active_attachments.clear();
        value(AttachmentListResult {
            attachments: Vec::new(),
            max_attachments: MAX_PENDING_ATTACHMENTS,
        })
    }

    pub async fn project_list(&self) -> Result<AppResponse, RuntimeError> {
        let active_project_id = self.active_project_id()?;
        let Some(token) = self.auth_token()? else {
            return Ok(value(ProjectListResult {
                projects: Vec::new(),
                active_project_id,
            }));
        };
        let projects = self.projects_with_local_workspaces(&token).await?;
        Ok(value(ProjectListResult {
            projects,
            active_project_id,
        }))
    }

    pub async fn project_create(
        &mut self,
        params: ProjectCreateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(RuntimeError::invalid_params("project name is required"));
        }
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for project.create"))?;
        let workspace_roots = normalize_workspace_roots(params.workspace_roots);
        let mut project = self
            .api_client
            .create_project(
                &token,
                ApiCreateProjectRequest {
                    name: name.to_string(),
                    description: params.description,
                    custom_instructions: params.custom_instructions,
                },
            )
            .await?;
        if !workspace_roots.is_empty() {
            self.save_project_workspace_roots(project.id, workspace_roots.clone())?;
            project.workspace_roots = workspace_roots;
        }
        Ok(value(ProjectResult { project }))
    }

    pub fn project_workspace_set(
        &mut self,
        params: ProjectWorkspaceSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.project_id <= 0 {
            return Err(RuntimeError::invalid_params("projectId must be positive"));
        }
        let workspace_roots = normalize_workspace_roots(params.workspace_roots);
        self.save_project_workspace_roots(params.project_id, workspace_roots.clone())?;
        Ok(value(ProjectWorkspaceResult {
            project_id: params.project_id,
            workspace_roots,
        }))
    }

    pub async fn project_delete(
        &mut self,
        params: ProjectIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for project.delete"))?;
        self.api_client
            .delete_project(&token, params.project_id)
            .await?;
        if self.active_project_id()? == Some(params.project_id) {
            self.set_metadata_value("active_project_id", "")?;
        }
        self.save_project_workspace_roots(params.project_id, Vec::new())?;
        Ok(value(AckResult { ok: true }))
    }

    pub fn project_use(&mut self, params: ProjectIDParams) -> Result<AppResponse, RuntimeError> {
        if params.project_id <= 0 {
            return Err(RuntimeError::invalid_params("projectId must be positive"));
        }
        self.set_metadata_value("active_project_id", &params.project_id.to_string())?;
        Ok(value(crate::protocol::ActiveProjectResult {
            active_project_id: Some(params.project_id),
        }))
    }

    pub fn project_clear(&mut self) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value("active_project_id", "")?;
        Ok(value(crate::protocol::ActiveProjectResult {
            active_project_id: None,
        }))
    }

    pub(crate) async fn projects_with_local_workspaces(
        &self,
        token: &str,
    ) -> Result<Vec<ProjectRecord>, RuntimeError> {
        let mut projects = self.api_client.list_projects(token).await?;
        let workspaces = self
            .metadata_json::<BTreeMap<i64, Vec<String>>>(PROJECT_WORKSPACES_METADATA_KEY)?
            .unwrap_or_default();
        for project in &mut projects {
            if let Some(workspace_roots) = workspaces.get(&project.id) {
                project.workspace_roots.clone_from(workspace_roots);
            }
        }
        Ok(projects)
    }

    fn save_project_workspace_roots(
        &mut self,
        project_id: i64,
        workspace_roots: Vec<String>,
    ) -> Result<(), RuntimeError> {
        let mut workspaces = self
            .metadata_json::<BTreeMap<i64, Vec<String>>>(PROJECT_WORKSPACES_METADATA_KEY)?
            .unwrap_or_default();
        if workspace_roots.is_empty() {
            workspaces.remove(&project_id);
        } else {
            workspaces.insert(project_id, workspace_roots);
        }
        self.set_metadata_json(PROJECT_WORKSPACES_METADATA_KEY, &workspaces)
    }
}
