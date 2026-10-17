//! Pure preparation against unmodified pinned Codex types. No startup, turn,
//! config loading, login enforcement, auth access, I/O, clock or executor.
//! Preparing options is NOT an admission decision. In particular startup may
//! initialize MCP and prewarm provider/auth before returning to the caller.
#![forbid(unsafe_code)]

mod request;
pub use request::BoundRequest;

use codex_core::{StartThreadOptions, config::Config};
use codex_extension_api::{
    ExtensionDataInit, IsolatedSessionExtensions, LoadedUserInstructions,
    SessionIsolation, ToolPolicy, empty_extension_registry,
};
use codex_features::Feature;
use codex_history::InitialHistory;
use codex_protocol::{
    config_types::ForcedLoginMethod, mcp::ClientMcpExtensions,
    protocol::{SessionSource, ThreadSource},
};

pub const CODEX_SOURCE_REVISION: &str = "0df4aa67781ae45a3c97befa4db48b734afe46d9";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparationError {
    InvalidRequest,
    RequestIdentityMismatch,
    ModelOrEffortMismatch,
    ExplicitMcpConfiguration,
    PluginConfiguration,
    CodeModeConfiguration,
    InheritedContextConfiguration,
    NonEphemeralConfiguration,
    ProviderIntentMismatch,
}

// Deliberately contains no config values, instructions, names, URLs or secrets.
impl std::fmt::Display for PreparationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "thread preparation rejected: {self:?}")
    }
}
impl std::error::Error for PreparationError {}

/// Owns the real prepared options but provides no consuming or mutable accessor.
/// An executable host and any release/start operation require a separate review.
/// There is deliberately no admission token, receipt, successful-run claim,
/// cancellation/cleanup result or output-validation bypass in this type.
pub struct PreparedThread<'a> {
    request: BoundRequest<'a>,
    options: StartThreadOptions,
}

impl PreparedThread<'_> {
    pub fn request(&self) -> &BoundRequest<'_> { &self.request }
    pub fn options(&self) -> &StartThreadOptions { &self.options }
}

/// Caller supplies an already-resolved Config; this function never loads it.
/// All administrator restrictions and supplied configuration remain unchanged.
/// Incompatible values are rejected, never cleared, relaxed or repaired.
pub fn prepare<'a>(
    request: BoundRequest<'a>,
    config: Config,
) -> Result<PreparedThread<'a>, PreparationError> {
    validate_config(&request, &config)?;
    let options = assemble(config);
    Ok(PreparedThread { request, options })
}

fn assemble(config: Config) -> StartThreadOptions {
    // Enumerate every field in the pinned real type: upstream additions must
    // cause a compilation/review decision rather than inherit a new default.
    StartThreadOptions {
        config,
        thread_instructions_provider: None,
        allow_provider_model_fallback: false,
        initial_history: InitialHistory::New,
        resume_preparation: None,
        internal_parent: None,
        history_mode: None,
        session_source: Some(SessionSource::Exec),
        thread_source: Some(ThreadSource::Feature("gelt_m4_preparation".to_owned())),
        dynamic_tools: Vec::new(),
        metrics_service_name: None,
        parent_trace: None,
        // None would discover default environments from the manager.
        environments: Some(Vec::new()),
        inherited_environments: None,
        user_instructions: Some(LoadedUserInstructions::default()),
        thread_extension_init: isolated_init(),
        turn_extension_init: ExtensionDataInit::default(),
        client_mcp_extensions: ClientMcpExtensions::default(),
        reserved_thread_id: None,
        disabled_plugin_ids: Some(Vec::new()),
    }
}

fn isolated_init() -> ExtensionDataInit {
    let mut init = ExtensionDataInit::default();
    init.insert(SessionIsolation::Isolated);
    init.insert(IsolatedSessionExtensions::<Config>(empty_extension_registry()));
    init.insert(ToolPolicy {
        allowed_tools: Some(Vec::new()),
        require_managed_sandbox: true,
        require_unified_exec: true,
        expose_additional_permissions: false,
    });
    init
}

// A private, borrowed projection makes pure policy cases testable without
// loading Config (which can read managed config, filesystem and environment).
// Only validate_config can construct this projection in the production path.
struct ConfigView<'a> {
    model: Option<&'a str>,
    effort: Option<&'a str>,
    has_mcp: bool,
    plugins_disabled: bool,
    code_mode: bool,
    inherited_context: bool,
    ephemeral: bool,
    subscription_intent: bool,
}

fn validate_config(request: &BoundRequest<'_>, config: &Config) -> Result<(), PreparationError> {
    validate_view(request, ConfigView {
        model: config.model.as_deref(),
        effort: config.model_reasoning_effort.as_ref().map(|e| e.as_str()),
        // Reject even disabled/managed explicit entries; no mutation of Constrained.
        has_mcp: !config.mcp_servers.get().is_empty() || config.orchestrator_mcp_enabled,
        plugins_disabled: config.plugins.default.as_ref().is_some_and(|d| !d.enabled)
            && config.plugins.plugins.is_empty()
            && !config.features.enabled(Feature::Plugins)
            && !config.features.enabled(Feature::PluginHooks)
            && !config.features.enabled(Feature::RemotePlugin),
        code_mode: [Feature::CodeMode, Feature::CodeModeOnly, Feature::CodeModeHost,
            Feature::CodeModeHostGrpc, Feature::CodeModePrewarm]
            .iter().any(|f| config.features.enabled(*f))
            || config.code_mode != Default::default(),
        inherited_context: config.base_instructions.is_some()
            || config.developer_instructions.is_some()
            || config.compact_prompt.is_some()
            || config.project_doc_max_bytes != 0
            || !config.project_doc_fallback_filenames.is_empty()
            || config.include_apps_instructions
            || config.include_skill_instructions
            || config.cloud_skill_enabled
            || config.include_environment_context
            || config.include_environment_context_time
            || config.include_collaboration_mode_instructions
            || config.notify.is_some(),
        ephemeral: config.ephemeral,
        // Configuration intent only, never effective auth/subscription proof.
        // Do NOT call enforce_login_restrictions here: it may log the owner out.
        subscription_intent: config.model_provider_id == "openai"
            && config.forced_login_method == Some(ForcedLoginMethod::Chatgpt),
    })
}

fn validate_view(request: &BoundRequest<'_>, v: ConfigView<'_>) -> Result<(), PreparationError> {
    if v.model != Some(request.model()) || v.effort != Some(request.effort()) {
        return Err(PreparationError::ModelOrEffortMismatch);
    }
    if v.has_mcp { return Err(PreparationError::ExplicitMcpConfiguration); }
    if !v.plugins_disabled { return Err(PreparationError::PluginConfiguration); }
    if v.code_mode { return Err(PreparationError::CodeModeConfiguration); }
    if v.inherited_context { return Err(PreparationError::InheritedContextConfiguration); }
    if !v.ephemeral { return Err(PreparationError::NonEphemeralConfiguration); }
    if !v.subscription_intent { return Err(PreparationError::ProviderIntentMismatch); }
    Ok(())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod config_fixture;
