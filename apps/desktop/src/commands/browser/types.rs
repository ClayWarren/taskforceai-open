#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserOpenParams {
    pub(super) url: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserStatus {
    pub(super) open: bool,
    pub(super) current_url: Option<String>,
    pub(super) message: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserMountParams {
    pub(super) bounds: DesktopBrowserMountBounds,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserMountBounds {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserActionParams {
    pub(super) action: String,
    pub(super) selector: Option<String>,
    pub(super) x: Option<f64>,
    pub(super) y: Option<f64>,
    pub(super) text: Option<String>,
    pub(super) key: Option<String>,
    pub(super) delta_x: Option<f64>,
    pub(super) delta_y: Option<f64>,
    pub(super) duration_ms: Option<u64>,
    pub(super) mode: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserInspectParams {
    pub(super) selector: Option<String>,
    pub(super) max_text_bytes: Option<usize>,
    pub(super) max_elements: Option<usize>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserRect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
    pub(super) top: f64,
    pub(super) right: f64,
    pub(super) bottom: f64,
    pub(super) left: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserPoint {
    pub(super) x: f64,
    pub(super) y: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserViewport {
    pub(super) width: f64,
    pub(super) height: f64,
    pub(super) device_scale_factor: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserElement {
    pub(super) tag_name: String,
    pub(super) id: Option<String>,
    pub(super) classes: Vec<String>,
    pub(super) text: Option<String>,
    pub(super) role: Option<String>,
    pub(super) aria_label: Option<String>,
    pub(super) name: Option<String>,
    pub(super) href: Option<String>,
    pub(super) value: Option<String>,
    pub(super) selector: Option<String>,
    pub(super) rect: DesktopBrowserRect,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserSelection {
    pub(super) mode: String,
    pub(super) point: Option<DesktopBrowserPoint>,
    pub(super) rect: Option<DesktopBrowserRect>,
    pub(super) element: Option<DesktopBrowserElement>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserActionResult {
    pub(super) action: String,
    pub(super) ok: bool,
    pub(super) message: String,
    pub(super) current_url: Option<String>,
    pub(super) selection: Option<DesktopBrowserSelection>,
    pub(super) inspection: Option<DesktopBrowserInspection>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserInspection {
    pub(super) title: String,
    pub(super) url: String,
    pub(super) ready_state: String,
    pub(super) viewport: DesktopBrowserViewport,
    pub(super) scroll: DesktopBrowserPoint,
    pub(super) active_element: Option<DesktopBrowserElement>,
    pub(super) elements: Vec<DesktopBrowserElement>,
    pub(super) text: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserAnnotation {
    pub(super) id: String,
    pub(super) text: String,
    pub(super) target: Option<String>,
    pub(super) x: Option<f64>,
    pub(super) y: Option<f64>,
    pub(super) width: Option<f64>,
    pub(super) height: Option<f64>,
    pub(super) kind: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserAnnotationsParams {
    pub(super) annotations: Vec<DesktopBrowserAnnotation>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserScreenshotResult {
    pub(super) path: String,
    pub(super) image_base64: String,
    pub(super) media_type: String,
    pub(super) byte_length: usize,
    pub(super) current_url: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserDevtoolsStatus {
    pub(super) supported: bool,
    pub(super) open: bool,
    pub(super) message: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserLogEntry {
    pub(super) level: String,
    pub(super) message: String,
    pub(super) args: Vec<String>,
    pub(super) timestamp: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserNetworkEntry {
    pub(super) r#type: String,
    pub(super) method: String,
    pub(super) url: String,
    pub(super) status: Option<u16>,
    pub(super) ok: Option<bool>,
    pub(super) duration_ms: Option<f64>,
    pub(super) error: Option<String>,
    pub(super) timestamp: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserErrorEntry {
    pub(super) message: String,
    pub(super) source: Option<String>,
    pub(super) line: Option<u32>,
    pub(super) column: Option<u32>,
    pub(super) stack: Option<String>,
    pub(super) timestamp: f64,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBrowserDiagnostics {
    pub(super) url: String,
    pub(super) title: String,
    pub(super) captured_at: f64,
    pub(super) started_at: f64,
    pub(super) logs: Vec<DesktopBrowserLogEntry>,
    pub(super) network: Vec<DesktopBrowserNetworkEntry>,
    pub(super) errors: Vec<DesktopBrowserErrorEntry>,
    pub(super) performance: serde_json::Value,
}
