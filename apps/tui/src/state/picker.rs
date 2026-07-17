use super::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickerKind {
    Resume,
    Rollback,
    Theme,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickerOption {
    pub value: String,
    pub title: String,
    pub detail: String,
    pub search_text: String,
}

impl PickerOption {
    pub fn new(
        value: impl Into<String>,
        title: impl Into<String>,
        detail: impl Into<String>,
        search_text: impl Into<String>,
    ) -> Self {
        Self {
            value: value.into(),
            title: title.into(),
            detail: detail.into(),
            search_text: search_text.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PickerState {
    pub kind: PickerKind,
    pub title: String,
    pub options: Vec<PickerOption>,
    pub query: String,
    pub selected_index: usize,
    pub original_theme: Option<String>,
}

impl PickerState {
    pub fn filtered_indices(&self) -> Vec<usize> {
        let query = self.query.trim().to_ascii_lowercase();
        self.options
            .iter()
            .enumerate()
            .filter_map(|(index, option)| {
                (query.is_empty()
                    || option.title.to_ascii_lowercase().contains(&query)
                    || option.detail.to_ascii_lowercase().contains(&query)
                    || option.search_text.to_ascii_lowercase().contains(&query))
                .then_some(index)
            })
            .collect()
    }

    pub fn selected_option(&self) -> Option<&PickerOption> {
        let index = *self.filtered_indices().get(self.selected_index)?;
        self.options.get(index)
    }
}

impl AppState {
    pub fn picker_active(&self) -> bool {
        self.picker.is_some()
    }

    pub fn picker_kind(&self) -> Option<PickerKind> {
        self.picker.as_ref().map(|picker| picker.kind)
    }

    pub fn selected_picker_option(&self) -> Option<&PickerOption> {
        self.picker.as_ref()?.selected_option()
    }

    pub fn open_picker(
        &mut self,
        kind: PickerKind,
        title: impl Into<String>,
        options: Vec<PickerOption>,
        original_theme: Option<String>,
    ) {
        self.launch_screen_visible = false;
        self.clear_prompt();
        self.command_output = None;
        self.model_selector = None;
        self.effort_selector = None;
        self.agent_mode_selector = None;
        self.team_config = None;
        let title = title.into();
        self.status_line = title.clone();
        self.picker = Some(PickerState {
            kind,
            title,
            options,
            query: String::new(),
            selected_index: 0,
            original_theme,
        });
    }

    pub fn close_picker(&mut self, status: impl Into<String>) {
        self.picker = None;
        self.status_line = status.into();
    }

    pub fn select_picker_by_delta(&mut self, delta: isize) {
        let Some(picker) = &mut self.picker else {
            return;
        };
        let len = picker.filtered_indices().len();
        if len == 0 {
            picker.selected_index = 0;
            return;
        }
        picker.selected_index = if delta.is_negative() {
            picker
                .selected_index
                .checked_sub(1)
                .unwrap_or(len.saturating_sub(1))
        } else {
            (picker.selected_index + 1) % len
        };
    }

    pub fn select_picker_value(&mut self, value: &str) {
        let Some(picker) = &mut self.picker else {
            return;
        };
        if let Some(index) = picker
            .filtered_indices()
            .into_iter()
            .position(|option_index| picker.options[option_index].value == value)
        {
            picker.selected_index = index;
        }
    }

    pub fn append_picker_query(&mut self, value: char) {
        if let Some(picker) = &mut self.picker {
            picker.query.push(value);
            picker.selected_index = 0;
            self.status_line = format!("Filter: {}", picker.query);
        }
    }

    pub fn paste_picker_query(&mut self, value: &str) {
        if let Some(picker) = &mut self.picker {
            picker.query.push_str(value);
            picker.selected_index = 0;
            self.status_line = format!("Filter: {}", picker.query);
        }
    }

    pub fn backspace_picker_query(&mut self) {
        if let Some(picker) = &mut self.picker {
            picker.query.pop();
            picker.selected_index = 0;
            self.status_line = if picker.query.is_empty() {
                picker.title.clone()
            } else {
                format!("Filter: {}", picker.query)
            };
        }
    }
}
