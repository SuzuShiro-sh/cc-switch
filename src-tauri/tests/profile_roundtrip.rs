//! 项目 Profile 快照/应用的端到端集成测试
//!
//! 全链路 apply 会写 live 配置文件——support.rs 已把 HOME 指向临时目录，安全。

use std::fs;

use serde_json::json;

use cc_switch_lib::{
    AppType, InstalledSkill, McpServer, McpService, ProfileApplyResult, ProfilePayload,
    ProfileScope, ProfileService, Prompt, PromptService, Provider, ProviderService, SkillApps,
    SkillService,
};

#[path = "support.rs"]
mod support;
use support::{create_test_state, ensure_test_home, reset_test_fs, test_mutex};

fn claude_provider(id: &str, token: &str) -> Provider {
    Provider::with_id(
        id.to_string(),
        id.to_uppercase(),
        json!({
            "env": {
                "ANTHROPIC_AUTH_TOKEN": token,
                "ANTHROPIC_BASE_URL": "https://api.test"
            }
        }),
        None,
    )
}

/// 构造可切换、可被本地路由接管的 Grok Build 测试供应商。
fn grokbuild_provider(id: &str, endpoint: &str, api_key: &str) -> Provider {
    let config = format!(
        r#"[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "{endpoint}"
name = "{id}"
api_key = "{api_key}"
api_backend = "responses"
context_window = 500000
"#
    );
    let mut provider = Provider::with_id(
        id.to_string(),
        id.to_uppercase(),
        json!({ "config": config }),
        None,
    );
    provider.category = Some("custom".to_string());
    provider
}

/// Claude Desktop 供应商：无 meta 时默认 Direct 模式，只要求 env 里有 token + base_url
fn desktop_provider(id: &str, token: &str) -> Provider {
    Provider::with_id(
        id.to_string(),
        id.to_uppercase(),
        json!({
            "env": {
                "ANTHROPIC_AUTH_TOKEN": token,
                "ANTHROPIC_BASE_URL": "https://desktop.test"
            }
        }),
        None,
    )
}

fn mcp_server(id: &str, claude_enabled: bool) -> McpServer {
    serde_json::from_value(json!({
        "id": id,
        "name": id,
        "server": { "command": "echo", "args": [] },
        "apps": { "claude": claude_enabled }
    }))
    .expect("construct mcp server")
}

/// 构造仅对 Grok Build 启用的 MCP 测试服务。
fn grokbuild_mcp_server(id: &str, enabled: bool) -> McpServer {
    serde_json::from_value(json!({
        "id": id,
        "name": id,
        "server": { "command": "echo", "args": [] },
        "apps": { "grokbuild": enabled }
    }))
    .expect("construct Grok Build MCP server")
}

fn prompt(id: &str, enabled: bool) -> Prompt {
    Prompt {
        id: id.to_string(),
        name: id.to_uppercase(),
        content: format!("# prompt {id}\n"),
        description: None,
        enabled,
        created_at: Some(1_000),
        updated_at: Some(1_000),
    }
}

fn installed_skill(id: &str, directory: &str, claude_enabled: bool) -> InstalledSkill {
    InstalledSkill {
        id: id.to_string(),
        name: id.to_string(),
        description: None,
        directory: directory.to_string(),
        repo_owner: None,
        repo_name: None,
        repo_branch: None,
        readme_url: None,
        apps: SkillApps {
            claude: claude_enabled,
            ..Default::default()
        },
        installed_at: 1_000,
        content_hash: None,
        updated_at: 0,
    }
}

/// 构造仅对 Grok Build 启用的本地 Skill。
fn installed_grokbuild_skill(id: &str, directory: &str) -> InstalledSkill {
    let mut skill = installed_skill(id, directory, false);
    skill.apps.grokbuild = true;
    skill
}

fn write_ssot_skill(directory: &str) {
    let dir = SkillService::get_ssot_dir()
        .expect("resolve skills SSOT dir")
        .join(directory);
    fs::create_dir_all(&dir).expect("create skill dir");
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {directory}\ndescription: Test skill\n---\n"),
    )
    .expect("write SKILL.md");
}

/// 走完整 Profile 应用链：同步写基础配置，再在 Tokio 运行时中收敛路由状态。
fn apply_profile(state: &cc_switch_lib::AppState, profile_id: &str) -> ProfileApplyResult {
    let rt = tokio::runtime::Runtime::new().expect("create routing runtime");
    apply_profile_with_runtime(state, profile_id, &rt)
}

fn apply_profile_with_runtime(
    state: &cc_switch_lib::AppState,
    profile_id: &str,
    rt: &tokio::runtime::Runtime,
) -> ProfileApplyResult {
    let mut result = ProfileService::apply(state, profile_id).expect("apply profile config");
    rt.block_on(ProfileService::finalize_routing(
        state,
        &result.routing_targets,
        &mut result.warnings,
    ));
    result
}

fn use_ephemeral_proxy_port(state: &cc_switch_lib::AppState) {
    futures::executor::block_on(async {
        let mut proxy_config = state.db.get_proxy_config().await.expect("get proxy config");
        proxy_config.listen_port = 0;
        state
            .db
            .update_proxy_config(proxy_config)
            .await
            .expect("set ephemeral proxy port");
    });
}

#[test]
fn profile_snapshot_apply_roundtrip_restores_configuration() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    // ---- 种子数据：2 个 Claude 供应商（p1 为当前）+ 2 个 MCP + 1 个 Skill + 2 个 Prompt ----
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_provider("p1", "key-1"))
        .expect("save provider p1");
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_provider("p2", "key-2"))
        .expect("save provider p2");
    state
        .db
        .set_current_provider(AppType::Claude.as_str(), "p1")
        .expect("set current provider p1");

    // Claude Desktop 只有供应商一个活跃维度（MCP/Skills/Prompt 对它不适用）
    state
        .db
        .save_provider(
            AppType::ClaudeDesktop.as_str(),
            &desktop_provider("d1", "dk-1"),
        )
        .expect("save desktop provider d1");
    state
        .db
        .save_provider(
            AppType::ClaudeDesktop.as_str(),
            &desktop_provider("d2", "dk-2"),
        )
        .expect("save desktop provider d2");
    state
        .db
        .set_current_provider(AppType::ClaudeDesktop.as_str(), "d1")
        .expect("set current desktop provider d1");

    // 让 live settings.json 与 p1 一致（switch_normal 回填需要）
    let claude_dir = home.join(".claude");
    fs::create_dir_all(&claude_dir).expect("create .claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        serde_json::to_string_pretty(&claude_provider("p1", "key-1").settings_config)
            .expect("serialize p1 settings"),
    )
    .expect("seed live settings.json");

    state
        .db
        .save_mcp_server(&mcp_server("m1", true))
        .expect("save mcp m1");
    state
        .db
        .save_mcp_server(&mcp_server("m2", false))
        .expect("save mcp m2");

    write_ssot_skill("test-skill");
    state
        .db
        .save_skill(&installed_skill("local:test-skill", "test-skill", true))
        .expect("save skill");

    state
        .db
        .save_prompt(AppType::Claude.as_str(), &prompt("pr1", true))
        .expect("save prompt pr1");
    state
        .db
        .save_prompt(AppType::Claude.as_str(), &prompt("pr2", false))
        .expect("save prompt pr2");

    // ---- 保存项目 A（在 Claude 页新建：只拍 Claude 当前状态）----
    let profile_a = ProfileService::create(&state, "Project A", ProfileScope::Claude)
        .expect("create profile A");
    let payload: ProfilePayload =
        serde_json::from_str(&profile_a.payload).expect("parse profile A payload");
    assert_eq!(payload.providers.claude.as_deref(), Some("p1"));
    assert_eq!(payload.mcp.claude, Some(vec!["m1".to_string()]));
    assert_eq!(
        payload.skills.claude,
        Some(vec!["local:test-skill".to_string()])
    );
    assert_eq!(payload.prompts.claude.as_deref(), Some("pr1"));
    assert_eq!(
        payload.providers.codex, None,
        "codex side not captured when creating from the claude group"
    );
    assert_eq!(payload.mcp.codex, None, "uncaptured side stays None");
    assert_eq!(
        payload.providers.claude_desktop, None,
        "claude desktop has its own profile scope"
    );

    // ---- 改动全部四类配置（走真实切换路径）----
    ProviderService::switch(&state, AppType::Claude, "p2").expect("switch to p2");
    // Desktop 现在有自己的项目分组；Claude 分组 apply 不应再影响 Desktop
    #[cfg(any(target_os = "macos", windows))]
    ProviderService::switch(&state, AppType::ClaudeDesktop, "d2").expect("switch desktop to d2");
    McpService::toggle_app(&state, "m1", AppType::Claude, false).expect("disable m1");
    McpService::toggle_app(&state, "m2", AppType::Claude, true).expect("enable m2");
    SkillService::toggle_app(&state.db, "local:test-skill", &AppType::Claude, false)
        .expect("disable skill");
    PromptService::enable_prompt(&state, AppType::Claude, "pr2").expect("enable pr2");

    // ---- 应用项目 A（Claude 组）：只复原 Claude 侧 ----
    let result = apply_profile(&state, &profile_a.id);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );

    let current = state
        .db
        .get_current_provider(AppType::Claude.as_str())
        .expect("get current provider");
    assert_eq!(current.as_deref(), Some("p1"), "provider restored to p1");

    // Claude 分组不再管理 Desktop：apply 后 Desktop 保持切换前的状态不变。
    // macOS/Windows 上上面已切到 d2；Linux（CI）不支持 Desktop 切换、那行被 cfg 门控
    // 编译剔除，Desktop 仍是种子值 d1。两种情况都验证 claude-scope apply 不会动 Desktop。
    let current_desktop = state
        .db
        .get_current_provider(AppType::ClaudeDesktop.as_str())
        .expect("get current desktop provider");
    #[cfg(any(target_os = "macos", windows))]
    let expected_desktop = "d2";
    #[cfg(not(any(target_os = "macos", windows)))]
    let expected_desktop = "d1";
    assert_eq!(
        current_desktop.as_deref(),
        Some(expected_desktop),
        "desktop provider untouched by claude-scope apply"
    );

    let servers = state.db.get_all_mcp_servers().expect("get mcp servers");
    assert!(servers.get("m1").expect("m1").apps.claude, "m1 re-enabled");
    assert!(!servers.get("m2").expect("m2").apps.claude, "m2 disabled");

    let skills = state.db.get_all_installed_skills().expect("get skills");
    assert!(
        skills.get("local:test-skill").expect("skill").apps.claude,
        "skill re-enabled"
    );

    let prompts = state
        .db
        .get_prompts(AppType::Claude.as_str())
        .expect("get prompts");
    assert!(prompts.get("pr1").expect("pr1").enabled, "pr1 re-enabled");
    assert!(!prompts.get("pr2").expect("pr2").enabled, "pr2 disabled");

    let live_prompt = fs::read_to_string(claude_dir.join("CLAUDE.md")).expect("read CLAUDE.md");
    assert_eq!(
        live_prompt,
        prompt("pr1", true).content,
        "live memory file restored"
    );

    assert_eq!(
        state
            .db
            .get_current_profile_id("claude")
            .expect("get current profile id")
            .as_deref(),
        Some(profile_a.id.as_str()),
        "profile A marked as current for claude scope"
    );
    assert_eq!(
        state
            .db
            .get_current_profile_id("codex")
            .expect("get codex current profile id"),
        None,
        "codex scope marker untouched by claude-group apply"
    );
}

#[test]
fn multi_agent_profile_applies_all_targets_as_one_bundle() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let state = create_test_state().expect("create test state");
    use_ephemeral_proxy_port(&state);

    // 种子：Claude 侧有当前供应商 + 启用的 MCP
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_provider("p1", "key-1"))
        .expect("save provider p1");
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_provider("p2", "key-2"))
        .expect("save provider p2");
    state
        .db
        .set_current_provider(AppType::Claude.as_str(), "p1")
        .expect("set current provider p1");
    let claude_dir = home.join(".claude");
    fs::create_dir_all(&claude_dir).expect("create .claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        serde_json::to_string_pretty(&claude_provider("p1", "key-1").settings_config)
            .expect("serialize p1 settings"),
    )
    .expect("seed live settings.json");
    state
        .db
        .save_mcp_server(&mcp_server("m1", true))
        .expect("save mcp m1");

    // 在 Codex 页新建项目，默认只绑定 Codex。
    let project = ProfileService::create(&state, "Shared Project", ProfileScope::Codex)
        .expect("create project from codex tab");
    let mut payload: ProfilePayload =
        serde_json::from_str(&project.payload).expect("parse project payload");
    assert_eq!(
        payload.providers.claude, None,
        "claude slot not captured by codex-side snapshot"
    );
    assert_eq!(payload.mcp.claude, None);
    assert_eq!(payload.providers.claude_desktop, None);
    assert_eq!(payload.mcp.codex, Some(vec![]), "codex side captured");
    assert_eq!(payload.targets, vec![ProfileScope::Codex]);

    // 在可视化编辑器中把 Claude 加入捆绑包并显式保存其配置。
    payload.targets = vec![ProfileScope::Claude, ProfileScope::Codex];
    payload.providers.claude = Some("p1".to_string());
    payload.mcp.claude = Some(vec!["m1".to_string()]);
    let routing = payload.routing.as_mut().expect("new profile routing state");
    routing.claude = Some(true);
    routing.codex = Some(false);
    ProfileService::update(&state, &project.id, None, Some(payload))
        .expect("save multi-agent profile payload");

    // 先制造 Claude 运行态偏移，再从任一 Agent 入口整体应用该方案。
    ProviderService::switch(&state, AppType::Claude, "p2").expect("switch to p2");
    McpService::toggle_app(&state, "m1", AppType::Claude, false).expect("disable m1");

    let rt = tokio::runtime::Runtime::new().expect("create routing runtime");
    let result = apply_profile_with_runtime(&state, &project.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );
    assert_eq!(
        result.target_scopes,
        vec![ProfileScope::Claude, ProfileScope::Codex]
    );
    assert_eq!(result.routing_targets.len(), 2);
    assert!(result
        .routing_targets
        .iter()
        .any(|target| target.app == AppType::Claude && target.enabled));
    assert!(result
        .routing_targets
        .iter()
        .any(|target| target.app == AppType::Codex && !target.enabled));
    assert_eq!(
        state
            .db
            .get_current_provider(AppType::Claude.as_str())
            .expect("get claude current provider")
            .as_deref(),
        Some("p1")
    );
    let servers = state.db.get_all_mcp_servers().expect("get mcp servers");
    assert!(
        servers.get("m1").expect("m1").apps.claude,
        "Claude side restored by the bundle"
    );
    assert_eq!(
        state
            .db
            .get_current_profile_id("claude")
            .expect("get claude current profile id")
            .as_deref(),
        Some(project.id.as_str())
    );
    assert_eq!(
        state
            .db
            .get_current_profile_id("codex")
            .expect("get codex current profile id")
            .as_deref(),
        Some(project.id.as_str())
    );
    assert!(
        state.db.get_proxy_flags_sync("claude").0,
        "Claude routing enabled by the bundle"
    );
    assert!(
        !state.db.get_proxy_flags_sync("codex").0,
        "Codex routing disabled by the bundle"
    );

    rt.block_on(state.proxy_service.set_takeover_for_app("claude", false))
        .expect("disable Claude routing after test");
}

/// 验证 Grok Build 配置方案可以完整恢复全部受管资源与路由状态。
#[test]
fn grokbuild_profile_roundtrip_restores_all_managed_resources() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let state = create_test_state().expect("create test state");
    use_ephemeral_proxy_port(&state);

    let provider_a = grokbuild_provider("grok-a", "https://grok-a.test/v1", "key-a");
    let provider_b = grokbuild_provider("grok-b", "https://grok-b.test/v1", "key-b");
    state
        .db
        .save_provider(AppType::GrokBuild.as_str(), &provider_a)
        .expect("save Grok Build provider A");
    state
        .db
        .save_provider(AppType::GrokBuild.as_str(), &provider_b)
        .expect("save Grok Build provider B");
    state
        .db
        .set_current_provider(AppType::GrokBuild.as_str(), "grok-a")
        .expect("set current Grok Build provider A");

    let grok_dir = home.join(".grok");
    fs::create_dir_all(&grok_dir).expect("create Grok Build config directory");
    fs::write(
        grok_dir.join("config.toml"),
        provider_a
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
            .expect("provider A TOML config"),
    )
    .expect("seed Grok Build live config");

    state
        .db
        .save_mcp_server(&grokbuild_mcp_server("grok-mcp", true))
        .expect("save Grok Build MCP");
    write_ssot_skill("grok-skill");
    state
        .db
        .save_skill(&installed_grokbuild_skill("local:grok-skill", "grok-skill"))
        .expect("save Grok Build Skill");
    state
        .db
        .save_prompt(AppType::GrokBuild.as_str(), &prompt("grok-pr-a", true))
        .expect("save Grok Build prompt A");
    state
        .db
        .save_prompt(AppType::GrokBuild.as_str(), &prompt("grok-pr-b", false))
        .expect("save Grok Build prompt B");

    let profile = ProfileService::create(&state, "Grok Project", ProfileScope::GrokBuild)
        .expect("create Grok Build profile");
    let mut payload: ProfilePayload =
        serde_json::from_str(&profile.payload).expect("parse Grok Build profile payload");
    assert_eq!(payload.targets, vec![ProfileScope::GrokBuild]);
    assert_eq!(payload.providers.grokbuild.as_deref(), Some("grok-a"));
    assert_eq!(payload.mcp.grokbuild, Some(vec!["grok-mcp".to_string()]));
    assert_eq!(
        payload.skills.grokbuild,
        Some(vec!["local:grok-skill".to_string()])
    );
    assert_eq!(payload.prompts.grokbuild.as_deref(), Some("grok-pr-a"));
    assert_eq!(
        payload.routing.as_ref().map(|routing| routing.grokbuild),
        Some(Some(false))
    );

    payload
        .routing
        .as_mut()
        .expect("Grok Build routing payload")
        .grokbuild = Some(true);
    ProfileService::update(&state, &profile.id, None, Some(payload))
        .expect("save Grok Build profile routing state");

    ProviderService::switch(&state, AppType::GrokBuild, "grok-b")
        .expect("switch to Grok Build provider B");
    McpService::toggle_app(&state, "grok-mcp", AppType::GrokBuild, false)
        .expect("disable Grok Build MCP");
    SkillService::toggle_app(&state.db, "local:grok-skill", &AppType::GrokBuild, false)
        .expect("disable Grok Build Skill");
    PromptService::enable_prompt(&state, AppType::GrokBuild, "grok-pr-b")
        .expect("enable Grok Build prompt B");

    let rt = tokio::runtime::Runtime::new().expect("create routing runtime");
    let result = apply_profile_with_runtime(&state, &profile.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "unexpected Grok Build warnings: {:?}",
        result.warnings
    );
    assert_eq!(result.target_scopes, vec![ProfileScope::GrokBuild]);
    assert_eq!(result.routing_targets.len(), 1);
    assert_eq!(result.routing_targets[0].app, AppType::GrokBuild);
    assert!(result.routing_targets[0].enabled);
    assert_eq!(
        state
            .db
            .get_current_provider(AppType::GrokBuild.as_str())
            .expect("get current Grok Build provider")
            .as_deref(),
        Some("grok-a")
    );
    assert!(
        state
            .db
            .get_all_mcp_servers()
            .expect("get MCP servers")
            .get("grok-mcp")
            .expect("Grok Build MCP")
            .apps
            .grokbuild
    );
    assert!(
        state
            .db
            .get_all_installed_skills()
            .expect("get installed Skills")
            .get("local:grok-skill")
            .expect("Grok Build Skill")
            .apps
            .grokbuild
    );
    let prompts = state
        .db
        .get_prompts(AppType::GrokBuild.as_str())
        .expect("get Grok Build prompts");
    assert!(prompts.get("grok-pr-a").expect("prompt A").enabled);
    assert!(!prompts.get("grok-pr-b").expect("prompt B").enabled);
    assert_eq!(
        state
            .db
            .get_current_profile_id(ProfileScope::GrokBuild.as_str())
            .expect("get current Grok Build profile")
            .as_deref(),
        Some(profile.id.as_str())
    );
    assert!(state.db.get_proxy_flags_sync("grokbuild").0);

    rt.block_on(state.proxy_service.set_takeover_for_app("grokbuild", false))
        .expect("disable Grok Build routing after test");
    let restored_config =
        fs::read_to_string(grok_dir.join("config.toml")).expect("read restored Grok Build config");
    assert!(restored_config.contains("https://grok-a.test/v1"));
}

#[test]
fn profile_apply_reports_dangling_references_and_continues() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    state
        .db
        .save_mcp_server(&mcp_server("m1", false))
        .expect("save mcp m1");

    // 手工构造引用了不存在资源的 payload
    let payload = json!({
        "providers": { "claude": "ghost-provider" },
        "mcp": { "claude": ["m1", "ghost-mcp"] },
        "skills": { "claude": ["ghost-skill"] },
        "prompts": { "claude": "ghost-prompt" }
    });
    let profile = cc_switch_lib::Profile {
        id: "dangling-test".to_string(),
        name: "Dangling".to_string(),
        payload: payload.to_string(),
        sort_order: None,
        created_at: Some(1_000),
        updated_at: Some(1_000),
    };
    state.db.save_profile(&profile).expect("save profile");

    let result = apply_profile(&state, "dangling-test");
    assert_eq!(
        result.warnings.len(),
        4,
        "each dangling reference yields one warning: {:?}",
        result.warnings
    );

    // 有效条目照常生效：m1 被启用
    let servers = state.db.get_all_mcp_servers().expect("get mcp servers");
    assert!(
        servers.get("m1").expect("m1").apps.claude,
        "m1 enabled despite warnings"
    );

    // best-effort 完成后仍标记为所属分组的当前项目
    assert_eq!(
        state
            .db
            .get_current_profile_id("claude")
            .expect("get current profile id")
            .as_deref(),
        Some("dangling-test")
    );
}

#[test]
fn clear_current_profile_only_clears_scoped_marker() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    state
        .db
        .set_current_profile_id("claude", Some("claude-profile"))
        .expect("set claude current profile");
    state
        .db
        .set_current_profile_id("codex", Some("codex-profile"))
        .expect("set codex current profile");

    // 清除 claude 组不影响 codex 组
    state
        .db
        .set_current_profile_id("claude", None)
        .expect("clear claude current profile");
    assert_eq!(
        state
            .db
            .get_current_profile_id("claude")
            .expect("get claude current profile id"),
        None
    );
    assert_eq!(
        state
            .db
            .get_current_profile_id("codex")
            .expect("get codex current profile id")
            .as_deref(),
        Some("codex-profile")
    );
}

#[test]
fn removing_target_clears_marker_without_changing_live_configuration() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");
    state
        .db
        .save_mcp_server(&mcp_server("m1", true))
        .expect("save mcp m1");

    let profile = ProfileService::create(&state, "Claude Project", ProfileScope::Claude)
        .expect("create claude profile");
    apply_profile(&state, &profile.id);

    let mut payload: ProfilePayload =
        serde_json::from_str(&profile.payload).expect("parse profile payload");
    payload.targets = vec![ProfileScope::Codex];
    payload.mcp.codex = Some(vec![]);
    ProfileService::update(&state, &profile.id, None, Some(payload)).expect("remove claude target");

    assert_eq!(
        state
            .db
            .get_current_profile_id("claude")
            .expect("get claude current profile"),
        None,
        "removed target must no longer show the profile as active"
    );
    let servers = state.db.get_all_mcp_servers().expect("get mcp servers");
    assert!(
        servers.get("m1").expect("m1").apps.claude,
        "removing a target must not rewrite the Agent's live configuration"
    );
}

#[test]
fn switching_profile_keeps_saved_snapshots_immutable() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    // ---- 种子：Claude 侧两套供应商 / MCP / Prompt ----
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_provider("p1", "key-1"))
        .expect("save provider p1");
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_provider("p2", "key-2"))
        .expect("save provider p2");
    state
        .db
        .set_current_provider(AppType::Claude.as_str(), "p1")
        .expect("set current provider p1");

    let claude_dir = home.join(".claude");
    fs::create_dir_all(&claude_dir).expect("create .claude dir");
    fs::write(
        claude_dir.join("settings.json"),
        serde_json::to_string_pretty(&claude_provider("p1", "key-1").settings_config)
            .expect("serialize p1 settings"),
    )
    .expect("seed live settings.json");

    state
        .db
        .save_mcp_server(&mcp_server("m1", true))
        .expect("save mcp m1");
    state
        .db
        .save_mcp_server(&mcp_server("m2", false))
        .expect("save mcp m2");

    state
        .db
        .save_prompt(AppType::Claude.as_str(), &prompt("pr1", true))
        .expect("save prompt pr1");
    state
        .db
        .save_prompt(AppType::Claude.as_str(), &prompt("pr2", false))
        .expect("save prompt pr2");

    // ---- Project A：状态 X（p1 / m1 / pr1）----
    let project_a = ProfileService::create(&state, "Project A", ProfileScope::Claude)
        .expect("create project A");
    let result = apply_profile(&state, &project_a.id);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );

    // ---- 在 A 下改到状态 Y（p2 / m2 / pr2），然后据此创建 Project B ----
    ProviderService::switch(&state, AppType::Claude, "p2").expect("switch to p2");
    McpService::toggle_app(&state, "m1", AppType::Claude, false).expect("disable m1");
    McpService::toggle_app(&state, "m2", AppType::Claude, true).expect("enable m2");
    PromptService::enable_prompt(&state, AppType::Claude, "pr2").expect("enable pr2");

    let project_b = ProfileService::create(&state, "Project B", ProfileScope::Claude)
        .expect("create project B");

    // ---- 从 A 切换到 B：加载 B 的 Y，但绝不把运行态 Y 回写到 A ----
    let result = apply_profile(&state, &project_b.id);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );

    assert_eq!(
        state
            .db
            .get_current_provider(AppType::Claude.as_str())
            .expect("get current provider")
            .as_deref(),
        Some("p2"),
        "provider switched to p2"
    );
    let servers = state.db.get_all_mcp_servers().expect("get mcp servers");
    assert!(!servers.get("m1").expect("m1").apps.claude, "m1 disabled");
    assert!(servers.get("m2").expect("m2").apps.claude, "m2 enabled");
    let prompts = state
        .db
        .get_prompts(AppType::Claude.as_str())
        .expect("get prompts");
    assert!(!prompts.get("pr1").expect("pr1").enabled, "pr1 disabled");
    assert!(prompts.get("pr2").expect("pr2").enabled, "pr2 enabled");

    // Project A 仍然保持创建时的独立快照 X。
    let saved_a = state
        .db
        .get_profile(&project_a.id)
        .expect("get project A")
        .expect("project A exists");
    let payload_a: ProfilePayload =
        serde_json::from_str(&saved_a.payload).expect("parse project A payload");
    assert_eq!(payload_a.providers.claude.as_deref(), Some("p1"));
    assert_eq!(payload_a.mcp.claude, Some(vec!["m1".to_string()]));
    assert_eq!(payload_a.prompts.claude.as_deref(), Some("pr1"));

    // ---- 切回 A：恢复它保存的 X，而不是离开 A 时的运行态 Y ----
    let result = apply_profile(&state, &project_a.id);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );

    assert_eq!(
        state
            .db
            .get_current_provider(AppType::Claude.as_str())
            .expect("get current provider")
            .as_deref(),
        Some("p1"),
        "project A restores its saved provider"
    );
    let servers = state.db.get_all_mcp_servers().expect("get mcp servers");
    assert!(servers.get("m1").expect("m1").apps.claude, "m1 restored");
    assert!(!servers.get("m2").expect("m2").apps.claude, "m2 disabled");
    let prompts = state
        .db
        .get_prompts(AppType::Claude.as_str())
        .expect("get prompts");
    assert!(prompts.get("pr1").expect("pr1").enabled, "pr1 restored");
    assert!(!prompts.get("pr2").expect("pr2").enabled, "pr2 disabled");

    // Project B 也保持创建时的独立快照 Y。
    let saved_b = state
        .db
        .get_profile(&project_b.id)
        .expect("get project B")
        .expect("project B exists");
    let payload_b: ProfilePayload =
        serde_json::from_str(&saved_b.payload).expect("parse project B payload");
    assert_eq!(payload_b.providers.claude.as_deref(), Some("p2"));
    assert_eq!(payload_b.mcp.claude, Some(vec!["m2".to_string()]));
    assert_eq!(payload_b.prompts.claude.as_deref(), Some("pr2"));
}

#[test]
fn profile_routing_supports_enabled_disabled_unmanaged_and_legacy_modes() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let state = create_test_state().expect("create test state");
    use_ephemeral_proxy_port(&state);

    // ---- 两个 Claude 供应商：custom1 与 custom2 ----
    let mut custom1 = claude_provider("custom1", "custom-key-1");
    custom1.category = Some("custom".to_string());
    state
        .db
        .save_provider(AppType::Claude.as_str(), &custom1)
        .expect("save custom1 provider");

    let mut custom2 = claude_provider("custom2", "custom-key-2");
    custom2.category = Some("custom".to_string());
    state
        .db
        .save_provider(AppType::Claude.as_str(), &custom2)
        .expect("save custom2 provider");

    // 初始状态：custom1 + 代理接管
    ProviderService::switch(&state, AppType::Claude, "custom1").expect("switch to custom1");
    let rt = tokio::runtime::Runtime::new().expect("create tokio runtime");
    rt.block_on(state.proxy_service.set_takeover_for_app("claude", true))
        .expect("enable claude takeover");

    assert!(state.db.get_proxy_flags_sync("claude").0);

    // 新方案会快照当前已开启的路由。应用时先恢复真实 Live、切换供应商，
    // 再重新接管，最终状态仍为开启。
    let project = ProfileService::create(&state, "Custom2 Project", ProfileScope::Claude)
        .expect("create project");
    let mut saved_project = state
        .db
        .get_profile(&project.id)
        .expect("get project")
        .expect("project exists");
    let mut payload: ProfilePayload =
        serde_json::from_str(&saved_project.payload).expect("parse project payload");
    assert_eq!(
        payload.routing.as_ref().map(|routing| routing.claude),
        Some(Some(true)),
        "new profile captures the active routing state"
    );
    payload.providers.claude = Some("custom2".to_string());
    saved_project.payload = serde_json::to_string(&payload).expect("serialize payload");
    state
        .db
        .save_profile(&saved_project)
        .expect("save updated project");

    let result = apply_profile_with_runtime(&state, &project.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "switching project should not warn: {:?}",
        result.warnings
    );
    assert!(
        state.db.get_proxy_flags_sync("claude").0,
        "managed enabled routing is restored after provider switch"
    );
    assert_eq!(
        state
            .db
            .get_current_provider(AppType::Claude.as_str())
            .expect("get current provider")
            .as_deref(),
        Some("custom2"),
        "current provider should be custom2"
    );

    let settings_path = home.join(".claude/settings.json");
    let settings: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).expect("read settings"))
            .expect("parse settings");
    let base_url = settings
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str());
    assert!(
        base_url.is_some_and(|url| url.starts_with("http://127.0.0.1:")),
        "enabled routing writes the local proxy endpoint, got {base_url:?}"
    );

    // 未管理路由：切换供应商时保留既有接管，通过现有代理热切换路径生效。
    payload.providers.claude = Some("custom1".to_string());
    payload.routing.as_mut().expect("routing payload").claude = None;
    ProfileService::update(&state, &project.id, None, Some(payload.clone()))
        .expect("save unmanaged routing profile");
    let result = apply_profile_with_runtime(&state, &project.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );
    assert!(
        result.routing_targets.is_empty(),
        "unmanaged routing must not schedule a route change"
    );
    assert!(
        state.db.get_proxy_flags_sync("claude").0,
        "unmanaged routing preserves active takeover"
    );
    assert_eq!(
        state
            .db
            .get_current_provider(AppType::Claude.as_str())
            .expect("get current provider")
            .as_deref(),
        Some("custom1")
    );

    // 显式关闭：退出接管并把目标供应商的真实 endpoint 写回 Live。
    payload.providers.claude = Some("custom2".to_string());
    payload.routing.as_mut().expect("routing payload").claude = Some(false);
    ProfileService::update(&state, &project.id, None, Some(payload.clone()))
        .expect("save disabled routing profile");
    let result = apply_profile_with_runtime(&state, &project.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );
    assert!(
        !state.db.get_proxy_flags_sync("claude").0,
        "managed disabled routing turns takeover off"
    );
    let settings: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&settings_path).expect("read settings"))
            .expect("parse settings");
    let base_url = settings
        .get("env")
        .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
        .and_then(|v| v.as_str());
    assert_eq!(
        base_url,
        Some("https://api.test"),
        "disabled routing restores the real provider endpoint"
    );

    // 从关闭状态显式开启，验证方案能够启动服务并接管 Live。
    payload.providers.claude = Some("custom1".to_string());
    payload.routing.as_mut().expect("routing payload").claude = Some(true);
    ProfileService::update(&state, &project.id, None, Some(payload))
        .expect("save enabled routing profile");
    let result = apply_profile_with_runtime(&state, &project.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );
    assert!(
        state.db.get_proxy_flags_sync("claude").0,
        "managed enabled routing starts takeover"
    );

    // 旧方案完全没有 routing 字段，必须继续沿用升级前的行为：关闭路由。
    let legacy_profile = cc_switch_lib::Profile {
        id: "legacy-routing-profile".to_string(),
        name: "Legacy routing profile".to_string(),
        payload: json!({
            "targets": ["claude"],
            "providers": { "claude": "custom2" }
        })
        .to_string(),
        sort_order: None,
        created_at: Some(1_000),
        updated_at: Some(1_000),
    };
    state
        .db
        .save_profile(&legacy_profile)
        .expect("save legacy profile");
    let result = apply_profile_with_runtime(&state, &legacy_profile.id, &rt);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );
    assert!(
        !state.db.get_proxy_flags_sync("claude").0,
        "legacy profile preserves the historical auto-disable behavior"
    );
    assert_eq!(
        state
            .db
            .get_current_provider(AppType::Claude.as_str())
            .expect("get current provider")
            .as_deref(),
        Some("custom2")
    );
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn claude_desktop_profile_scope_is_independent() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    state
        .db
        .save_provider(
            AppType::ClaudeDesktop.as_str(),
            &desktop_provider("d1", "dk-1"),
        )
        .expect("save desktop provider d1");
    state
        .db
        .save_provider(
            AppType::ClaudeDesktop.as_str(),
            &desktop_provider("d2", "dk-2"),
        )
        .expect("save desktop provider d2");
    state
        .db
        .set_current_provider(AppType::ClaudeDesktop.as_str(), "d1")
        .expect("set current desktop provider d1");

    // 在 Desktop 页新建项目：只拍 Desktop 供应商
    let project = ProfileService::create(&state, "Desktop Project", ProfileScope::ClaudeDesktop)
        .expect("create desktop profile");
    let payload: ProfilePayload =
        serde_json::from_str(&project.payload).expect("parse desktop payload");
    assert_eq!(payload.providers.claude_desktop.as_deref(), Some("d1"));
    assert_eq!(payload.providers.claude, None, "claude slot untouched");
    assert_eq!(payload.providers.codex, None, "codex slot untouched");

    // 切到 d2
    ProviderService::switch(&state, AppType::ClaudeDesktop, "d2").expect("switch desktop to d2");

    // 应用 Desktop 项目：恢复 d1
    let result = apply_profile(&state, &project.id);
    assert!(
        result.warnings.is_empty(),
        "unexpected warnings: {:?}",
        result.warnings
    );

    assert_eq!(
        state
            .db
            .get_current_provider(AppType::ClaudeDesktop.as_str())
            .expect("get current desktop provider")
            .as_deref(),
        Some("d1"),
        "desktop provider restored by desktop-scope apply"
    );
    assert_eq!(
        state
            .db
            .get_current_profile_id(ProfileScope::ClaudeDesktop.as_str())
            .expect("get desktop current profile id")
            .as_deref(),
        Some(project.id.as_str()),
        "desktop scope marker set"
    );
}
