use taskforceai_app_protocol::{ModelListResult, ModelOptionRecord, RunRecord};

use super::{AppState, EffortSelectorState, FocusArea, ModelSelectorState};

impl AppState {
    pub fn selected_run_id(&self) -> Option<&str> {
        self.selected_run_id.as_deref()
    }

    pub fn selected_run_index(&self) -> Option<usize> {
        self.valid_selected_run_index()
            .or_else(|| self.find_selected_run_index())
    }

    pub fn selected_run(&self) -> Option<&RunRecord> {
        if let Some(index) = self.valid_selected_run_index() {
            return self.runs.get(index);
        }
        self.find_selected_run_index()
            .and_then(|index| self.runs.get(index))
    }

    pub fn set_current_model(&mut self, model_id: impl Into<String>) {
        let model_id = model_id.into();
        let next_model_id = if model_id.trim().is_empty() {
            "default".to_string()
        } else {
            model_id
        };
        if self.current_model_id != next_model_id {
            self.reasoning_effort = None;
            self.effort_selector = None;
        }
        self.current_model_id = next_model_id;
    }

    pub fn model_selector_active(&self) -> bool {
        self.model_selector.is_some()
    }

    pub fn effort_selector_active(&self) -> bool {
        self.effort_selector.is_some()
    }

    pub fn selected_effort(&self) -> Option<&str> {
        let selector = self.effort_selector.as_ref()?;
        selector
            .levels
            .get(selector.selected_index)
            .map(String::as_str)
    }

    pub(super) fn open_effort_selector(&mut self, selector: EffortSelectorState) {
        self.model_selector = None;
        self.command_output = None;
        self.prompt_input.clear();
        self.refresh_command_suggestions();
        self.status_line = format!("Reasoning effort for {}", selector.model_id);
        self.effort_selector = Some(selector);
    }

    pub(super) fn select_effort_by_delta(&mut self, delta: isize) {
        let Some(selector) = &mut self.effort_selector else {
            return;
        };
        if selector.levels.is_empty() {
            selector.selected_index = 0;
            return;
        }
        let last = selector.levels.len().saturating_sub(1) as isize;
        selector.selected_index =
            (selector.selected_index as isize + delta).clamp(0, last) as usize;
        self.status_line = format!(
            "Reasoning effort: {}",
            selector.levels[selector.selected_index]
        );
    }

    pub(super) fn set_reasoning_effort(&mut self, effort: Option<String>) {
        self.reasoning_effort = effort.clone();
        self.effort_selector = None;
        let value = effort.as_deref().unwrap_or("model default");
        self.command_output = Some(format!("Reasoning Effort\nSelected {value}."));
        self.status_line = format!("Reasoning effort: {value}");
    }

    pub fn selected_model_option(&self) -> Option<&ModelOptionRecord> {
        let selector = self.model_selector.as_ref()?;
        selector.options.get(selector.selected_index)
    }

    pub(super) fn open_model_selector(&mut self, result: ModelListResult) {
        let current = result
            .selected_model_id
            .as_deref()
            .unwrap_or(&result.default_model_id);
        let selected_index = result
            .options
            .iter()
            .position(|option| option.id == current)
            .unwrap_or(0);
        self.set_current_model(current.to_string());
        self.command_output = None;
        self.prompt_input.clear();
        self.refresh_command_suggestions();
        self.model_selector = Some(ModelSelectorState {
            options: result.options,
            default_model_id: result.default_model_id,
            selected_model_id: result.selected_model_id,
            selected_index,
            remote_catalog: result.remote_catalog,
        });
        self.effort_selector = None;
        self.status_line = "Model selector".to_string();
    }

    pub(super) fn select_model_by_delta(&mut self, delta: isize) {
        let Some(selector) = &mut self.model_selector else {
            return;
        };
        if selector.options.is_empty() {
            selector.selected_index = 0;
            return;
        }
        let last = selector.options.len().saturating_sub(1) as isize;
        let next = (selector.selected_index as isize + delta).clamp(0, last) as usize;
        selector.selected_index = next;
        self.status_line = format!("Model {}", selector.options[next].id);
    }

    pub(super) fn upsert_run(&mut self, run: RunRecord) {
        let id = run.id.clone();
        if let Some(existing_index) = self.runs.iter().position(|item| item.id == run.id) {
            self.runs[existing_index] = run;
            if self.selected_run_id.as_deref() == Some(id.as_str()) {
                self.selected_run_index = Some(existing_index);
            }
        } else {
            self.runs.insert(0, run);
            if let Some(index) = self.selected_run_index {
                self.selected_run_index = Some(index.saturating_add(1));
            }
        }

        if self.selected_run_id.is_none() {
            self.selected_run_id = Some(id);
            self.selected_run_index = Some(0);
        }
        self.ensure_selection_is_valid();
    }

    pub(super) fn with_default_selection(mut self) -> Self {
        self.selected_run_id = self.runs.first().map(|run| run.id.clone());
        self.selected_run_index = self.selected_run_id.as_ref().map(|_| 0);
        self
    }

    pub(super) fn select_by_delta(&mut self, delta: isize) {
        if self.runs.is_empty() {
            self.selected_run_id = None;
            self.selected_run_index = None;
            self.status_line = "No conversations to select".to_string();
            return;
        }

        let current = self.selected_run_index().unwrap_or(0);
        let last = self.runs.len().saturating_sub(1) as isize;
        let next = (current as isize + delta).clamp(0, last) as usize;
        self.selected_run_id = Some(self.runs[next].id.clone());
        self.selected_run_index = Some(next);
        self.detail_scroll_offset = 0;
        self.command_output = None;
        self.status_line = "Selected conversation".to_string();
    }

    pub(super) fn select_by_index(&mut self, index: usize) {
        if let Some(run) = self.runs.get(index) {
            self.selected_run_id = Some(run.id.clone());
            self.selected_run_index = Some(index);
            self.detail_scroll_offset = 0;
            self.command_output = None;
            self.status_line = "Selected conversation".to_string();
        }
    }

    pub(super) fn load_selected_run_into_prompt(&mut self) {
        let Some(run) = self.selected_run().cloned() else {
            self.status_line = "No selected conversation to continue".to_string();
            return;
        };
        self.prompt_input = run.prompt;
        self.refresh_command_suggestions();
        self.command_output = Some(
            "Conversation\nLoaded the selected prompt. Edit and press Enter to continue."
                .to_string(),
        );
        self.focus = FocusArea::Prompt;
        self.status_line = "Loaded selected conversation into prompt".to_string();
    }

    pub(super) fn ensure_selection_is_valid(&mut self) {
        if self.valid_selected_run_index().is_some() {
            return;
        }
        if let Some(index) = self.find_selected_run_index() {
            self.selected_run_index = Some(index);
            return;
        }
        self.selected_run_id = self.runs.first().map(|run| run.id.clone());
        self.selected_run_index = self.selected_run_id.as_ref().map(|_| 0);
    }

    fn valid_selected_run_index(&self) -> Option<usize> {
        let selected = self.selected_run_id.as_deref()?;
        let index = self.selected_run_index?;
        self.runs
            .get(index)
            .is_some_and(|run| run.id == selected)
            .then_some(index)
    }

    fn find_selected_run_index(&self) -> Option<usize> {
        let selected = self.selected_run_id.as_ref()?;
        self.runs.iter().position(|run| &run.id == selected)
    }

    pub(super) fn remove_run(&mut self, run_id: &str) {
        let Some(removed_index) = self.runs.iter().position(|run| run.id == run_id) else {
            self.ensure_selection_is_valid();
            return;
        };
        self.runs.remove(removed_index);

        if self.runs.is_empty() {
            self.selected_run_id = None;
            self.selected_run_index = None;
            self.detail_scroll_offset = 0;
            return;
        }

        if let Some(selected) = &self.selected_run_id {
            if selected != run_id {
                let adjusted_index = self
                    .selected_run_index
                    .map(|index| {
                        if index > removed_index {
                            index.saturating_sub(1)
                        } else {
                            index
                        }
                    })
                    .unwrap_or(0);
                if self
                    .runs
                    .get(adjusted_index)
                    .is_some_and(|run| &run.id == selected)
                {
                    self.selected_run_index = Some(adjusted_index);
                    return;
                }
                if let Some(index) = self.runs.iter().position(|run| &run.id == selected) {
                    self.selected_run_index = Some(index);
                    return;
                }
            }
        }

        let next_index = removed_index.min(self.runs.len().saturating_sub(1));
        if let Some(run) = self.runs.get(next_index) {
            self.selected_run_id = Some(run.id.clone());
            self.selected_run_index = Some(next_index);
        // coverage:ignore-start -- guarded by the earlier non-empty runs check.
        } else {
            self.selected_run_id = None;
            self.selected_run_index = None;
        }
        // coverage:ignore-end
        self.detail_scroll_offset = 0;
    }

    pub(super) fn append_prompt(&mut self, value: char) {
        if value.is_control() {
            return;
        }
        self.prompt_input.push(value);
        self.refresh_command_suggestions();
    }

    pub(super) fn apply_voice_transcript(&mut self, transcript: String, replace: bool) {
        let transcript = transcript.trim();
        if transcript.is_empty() {
            self.status_line = "Voice transcript was empty".to_string();
            return;
        }
        if replace || self.prompt_input.trim().is_empty() {
            self.prompt_input = transcript.to_string();
        } else {
            if !self.prompt_input.ends_with(char::is_whitespace) {
                self.prompt_input.push(' ');
            }
            self.prompt_input.push_str(transcript);
        }
        self.refresh_command_suggestions();
        self.focus = FocusArea::Prompt;
        self.command_output = Some("Voice\nTranscript inserted into prompt.".to_string());
        self.status_line = "Voice transcript ready".to_string();
    }

    pub(super) fn toggle_focus(&mut self) {
        if self.sidebar_collapsed {
            self.focus = FocusArea::Prompt;
            self.status_line = "Conversation sidebar collapsed".to_string();
            return;
        }
        self.focus = match self.focus {
            FocusArea::Runs => FocusArea::Prompt,
            FocusArea::Prompt => FocusArea::Runs,
        };
        self.status_line = match self.focus {
            FocusArea::Runs => "Conversation focus".to_string(),
            FocusArea::Prompt => "Prompt focus".to_string(),
        };
    }

    pub(super) fn toggle_sidebar(&mut self) {
        self.sidebar_collapsed = !self.sidebar_collapsed;
        if self.sidebar_collapsed && self.focus == FocusArea::Runs {
            self.focus = FocusArea::Prompt;
        }
        self.status_line = if self.sidebar_collapsed {
            "Conversation sidebar collapsed"
        } else {
            "Conversation sidebar expanded"
        }
        .to_string();
    }

    pub(super) fn scroll_details(&mut self, delta: i16) {
        let current = i32::from(self.detail_scroll_offset);
        let next = (current + i32::from(delta)).max(0);
        self.detail_scroll_offset = next.min(i32::from(u16::MAX)) as u16;
        self.status_line = format!("Details scroll {}", self.detail_scroll_offset);
    }
}
