use super::*;
use sha2::{Digest, Sha256};

fn wire() -> Vec<u8> {
    format!(r#"{{"schema":"{}","runId":"123e4567-e89b-42d3-a456-426614174000","baseCommit":"{}","mockCandidateIdentitySha256":"{}","model":"gpt-6-astra","effort":"high","timeoutMs":1000}}"#,
        request::REQUEST_SCHEMA, request::HISTORICAL_BASE, request::HISTORICAL_MOCK).into_bytes()
}

fn digest(bytes: &[u8]) -> [u8; 32] { Sha256::digest(bytes).into() }

fn view() -> ConfigView<'static> {
    ConfigView {
        model: Some("gpt-6-astra"), effort: Some("high"), has_mcp: false,
        plugins_disabled: true, code_mode: false, inherited_context: false,
        ephemeral: true, subscription_intent: true,
    }
}

#[test]
fn retains_exact_bytes_and_all_request_identity() {
    let mut bytes = wire();
    bytes.extend_from_slice(b" \n");
    let request = BoundRequest::parse(&bytes, digest(&bytes)).unwrap();
    assert_eq!(request.bytes(), bytes.as_slice());
    assert_eq!(request.sha256(), digest(&bytes));
    assert_eq!(request.run_id(), "123e4567-e89b-42d3-a456-426614174000");
    assert_eq!(request.source_commit(), request::HISTORICAL_BASE);
    assert_eq!(request.mock_identity(), request::HISTORICAL_MOCK);
    assert_eq!(request.model(), "gpt-6-astra");
    assert_eq!(request.effort(), "high");
    assert_eq!(request.timeout_ms(), 1000);
    // JSON-equivalent bytes must still use the original owner's exact digest.
    assert!(matches!(BoundRequest::parse(&wire(), digest(&bytes)),
        Err(PreparationError::RequestIdentityMismatch)));
}

#[test]
fn rejects_identity_substitution_unknown_fields_and_duplicate_keys() {
    let original = String::from_utf8(wire()).unwrap();
    for altered in [
        original.replace(request::HISTORICAL_BASE, "beace9e281bb1d5f39cbb5253e572e86a92b0c04"),
        original.replace(request::HISTORICAL_MOCK, &"0".repeat(64)),
        original.replace(request::REQUEST_SCHEMA, "gelt.other.v1"),
        original.replace("123e4567-e89b-42d3-a456-426614174000", "not-a-run"),
        original.replace("\"timeoutMs\":1000", "\"timeoutMs\":1000,\"tool\":\"exec\""),
        original.replace("\"model\":\"gpt-6-astra\"", "\"model\":\"gpt-6-astra\",\"model\":\"gpt-6-astra\""),
        original.replace("\"effort\":\"high\"", "\"effort\":\"persistent\""),
        original.replace("\"timeoutMs\":1000", "\"timeoutMs\":999"),
        original.replace("\"timeoutMs\":1000", "\"timeoutMs\":300001"),
        original.replace("\"timeoutMs\":1000", "\"timeoutMs\":1000.5"),
        original.replace("gpt-6-astra", "model; command"),
    ] {
        assert!(matches!(BoundRequest::parse(altered.as_bytes(), digest(altered.as_bytes())),
            Err(PreparationError::InvalidRequest)));
    }
}

#[test]
fn enforces_bounded_request_and_sanitized_errors() {
    for bytes in [Vec::new(), vec![b' '; 4097], b"not json".to_vec()] {
        assert!(matches!(BoundRequest::parse(&bytes, digest(&bytes)),
            Err(PreparationError::InvalidRequest)));
    }
    let bytes = wire();
    assert!(matches!(BoundRequest::parse(&bytes, [0; 32]),
        Err(PreparationError::RequestIdentityMismatch)));
    assert_eq!(PreparationError::ExplicitMcpConfiguration.to_string(),
        "thread preparation rejected: ExplicitMcpConfiguration");
}

#[test]
fn installs_real_isolation_and_empty_startup_tool_ceiling() {
    let init = isolated_init();
    assert_eq!(*init.get::<SessionIsolation>().unwrap(), SessionIsolation::Isolated);
    assert!(init.get::<IsolatedSessionExtensions<Config>>().is_some());
    let policy = init.get::<ToolPolicy>().unwrap();
    assert!(policy.allowed_tools.as_ref().unwrap().is_empty());
    assert!(policy.require_managed_sandbox);
    assert!(policy.require_unified_exec);
    assert!(!policy.expose_additional_permissions);
    // Every preparation gets a new map: changing one cannot relax another.
    let mut changed = init.clone();
    changed.insert(ToolPolicy::default());
    assert!(changed.get::<ToolPolicy>().unwrap().allowed_tools.is_none());
    assert!(init.get::<ToolPolicy>().unwrap().allowed_tools.as_ref().unwrap().is_empty());
    assert!(isolated_init().get::<ToolPolicy>().unwrap().allowed_tools.as_ref().unwrap().is_empty());
}

#[test]
fn accepts_only_exact_model_effort_and_rejects_configuration_conflicts() {
    let bytes = wire();
    let request = BoundRequest::parse(&bytes, digest(&bytes)).unwrap();
    assert_eq!(validate_view(&request, view()), Ok(()));
    let cases: &[(fn(&mut ConfigView<'static>), PreparationError)] = &[
        (|v| v.model = None, PreparationError::ModelOrEffortMismatch),
        (|v| v.model = Some("fallback"), PreparationError::ModelOrEffortMismatch),
        (|v| v.effort = Some("low"), PreparationError::ModelOrEffortMismatch),
        (|v| v.has_mcp = true, PreparationError::ExplicitMcpConfiguration),
        (|v| v.plugins_disabled = false, PreparationError::PluginConfiguration),
        (|v| v.code_mode = true, PreparationError::CodeModeConfiguration),
        (|v| v.inherited_context = true, PreparationError::InheritedContextConfiguration),
        (|v| v.ephemeral = false, PreparationError::NonEphemeralConfiguration),
        (|v| v.subscription_intent = false, PreparationError::ProviderIntentMismatch),
    ];
    for (mutate, expected) in cases {
        let mut configuration = view();
        mutate(&mut configuration);
        assert_eq!(validate_view(&request, configuration), Err(*expected));
    }
}

// These additional tests construct the actual upstream Config in memory, with
// an exhaustive public-field literal. No ConfigBuilder or runtime is involved.
use crate::config_fixture::pure_config;

#[test]
fn prepares_real_options_and_preserves_the_complete_supplied_config() {
    let bytes = wire();
    let request = BoundRequest::parse(&bytes, digest(&bytes)).unwrap();
    let config = pure_config();
    // All Debug content here is fixed constructed data, never owner config.
    let before = format!("{config:?}");
    let prepared = prepare(request, config).unwrap_or_else(|e| panic!("{e}"));
    let o = prepared.options();
    assert_eq!(format!("{:?}", o.config), before);
    assert_eq!(prepared.request().bytes(), bytes.as_slice());
    assert_eq!(prepared.request().sha256(), digest(&bytes));
    assert!(o.thread_instructions_provider.is_none());
    assert!(!o.allow_provider_model_fallback);
    assert!(matches!(o.initial_history, InitialHistory::New));
    assert!(o.resume_preparation.is_none());
    assert!(o.internal_parent.is_none());
    assert!(o.history_mode.is_none());
    assert_eq!(o.session_source, Some(SessionSource::Exec));
    assert_eq!(o.thread_source,
        Some(ThreadSource::Feature("gelt_m4_preparation".to_owned())));
    assert!(o.dynamic_tools.is_empty());
    assert!(o.metrics_service_name.is_none());
    assert!(o.parent_trace.is_none());
    assert!(o.environments.as_ref().unwrap().is_empty());
    assert!(o.inherited_environments.is_none());
    assert_eq!(o.user_instructions, Some(LoadedUserInstructions::default()));
    assert_eq!(*o.thread_extension_init.get::<SessionIsolation>().unwrap(),
        SessionIsolation::Isolated);
    assert!(o.thread_extension_init.get::<IsolatedSessionExtensions<Config>>().is_some());
    let p = o.thread_extension_init.get::<ToolPolicy>().unwrap();
    assert!(p.allowed_tools.as_ref().unwrap().is_empty());
    assert!(p.require_managed_sandbox && p.require_unified_exec);
    assert!(!p.expose_additional_permissions);
    assert!(o.turn_extension_init.get::<ToolPolicy>().is_none());
    assert!(o.turn_extension_init.get::<SessionIsolation>().is_none());
    assert!(o.client_mcp_extensions.iter().next().is_none());
    assert!(o.reserved_thread_id.is_none());
    assert!(o.disabled_plugin_ids.as_ref().unwrap().is_empty());
}

#[test]
fn rejects_each_real_config_projection_conflict_without_mutation() {
    let bytes = wire();
    let request = BoundRequest::parse(&bytes, digest(&bytes)).unwrap();
    let cases: &[(fn(&mut Config), PreparationError)] = &[
        (|c| c.model = None, PreparationError::ModelOrEffortMismatch),
        (|c| c.model = Some("fallback".into()), PreparationError::ModelOrEffortMismatch),
        (|c| c.model_reasoning_effort = None, PreparationError::ModelOrEffortMismatch),
        (|c| c.model_reasoning_effort = Some(codex_protocol::openai_models::ReasoningEffort::Low), PreparationError::ModelOrEffortMismatch),
        (|c| c.orchestrator_mcp_enabled = true, PreparationError::ExplicitMcpConfiguration),
        (|c| c.plugins.default = None, PreparationError::PluginConfiguration),
        (|c| c.plugins.default.as_mut().unwrap().enabled = true, PreparationError::PluginConfiguration),
        (|c| c.base_instructions = Some(String::new()), PreparationError::InheritedContextConfiguration),
        (|c| c.developer_instructions = Some(String::new()), PreparationError::InheritedContextConfiguration),
        (|c| c.compact_prompt = Some(String::new()), PreparationError::InheritedContextConfiguration),
        (|c| c.project_doc_max_bytes = 1, PreparationError::InheritedContextConfiguration),
        (|c| c.project_doc_fallback_filenames.push("AGENTS.md".into()), PreparationError::InheritedContextConfiguration),
        (|c| c.include_apps_instructions = true, PreparationError::InheritedContextConfiguration),
        (|c| c.include_skill_instructions = true, PreparationError::InheritedContextConfiguration),
        (|c| c.cloud_skill_enabled = true, PreparationError::InheritedContextConfiguration),
        (|c| c.include_environment_context = true, PreparationError::InheritedContextConfiguration),
        (|c| c.include_environment_context_time = true, PreparationError::InheritedContextConfiguration),
        (|c| c.include_collaboration_mode_instructions = true, PreparationError::InheritedContextConfiguration),
        (|c| c.notify = Some(Vec::new()), PreparationError::InheritedContextConfiguration),
        (|c| c.ephemeral = false, PreparationError::NonEphemeralConfiguration),
        (|c| c.model_provider_id = "other".into(), PreparationError::ProviderIntentMismatch),
        (|c| c.forced_login_method = None, PreparationError::ProviderIntentMismatch),
        (|c| c.code_mode.default_exec_yield_time_ms += 1, PreparationError::CodeModeConfiguration),
    ];
    for (mutate, expected) in cases {
        let mut config = pure_config();
        mutate(&mut config);
        let before = format!("{config:?}");
        assert_eq!(validate_config(&request, &config), Err(*expected));
        assert_eq!(format!("{config:?}"), before);
        assert!(matches!(prepare(BoundRequest::parse(&bytes, digest(&bytes)).unwrap(), config), Err(e) if e == *expected));
    }
}

#[test]
fn rejects_real_feature_plugin_and_disabled_explicit_mcp_configuration() {
    let bytes = wire();
    let request = BoundRequest::parse(&bytes, digest(&bytes)).unwrap();
    for feature in [Feature::Plugins, Feature::PluginHooks, Feature::RemotePlugin,
        Feature::CodeMode, Feature::CodeModeOnly, Feature::CodeModeHost,
        Feature::CodeModeHostGrpc, Feature::CodeModePrewarm] {
        let mut config = pure_config();
        config.features.enable(feature).unwrap();
        let before = config.features.clone();
        let expected = if matches!(feature, Feature::Plugins | Feature::PluginHooks | Feature::RemotePlugin) {
            PreparationError::PluginConfiguration
        } else { PreparationError::CodeModeConfiguration };
        assert_eq!(validate_config(&request, &config), Err(expected));
        assert_eq!(config.features, before);
    }
    let mut config = pure_config();
    config.plugins.plugins.insert("constructed".into(), serde_json::from_value(
        serde_json::json!({"enabled":false})).unwrap());
    assert_eq!(validate_config(&request, &config), Err(PreparationError::PluginConfiguration));
    for enabled in [false, true] {
        let mut config = pure_config();
        let mcp: codex_config::McpServerConfig = serde_json::from_value(
            serde_json::json!({"command":"never-start-this-fixture", "enabled":enabled})).unwrap();
        config.mcp_servers = codex_config::Constrained::allow_any(
            std::collections::HashMap::from([("constructed".into(), mcp)]));
        let before = config.mcp_servers.get().clone();
        assert_eq!(validate_config(&request, &config), Err(PreparationError::ExplicitMcpConfiguration));
        assert_eq!(config.mcp_servers.get(), &before);
    }
}
