//! 项目 Profile 管理命令

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::database::Profile;
use crate::services::profile::{ProfileApplyResult, ProfilePayload, ProfileScope, ProfileService};
use crate::store::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub id: String,
    pub name: String,
    pub payload: ProfilePayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

impl From<Profile> for ProfileDto {
    fn from(profile: Profile) -> Self {
        // 单条 payload 损坏不应拖垮整个列表：降级为默认值并记日志
        let payload = serde_json::from_str(&profile.payload).unwrap_or_else(|e| {
            log::warn!(
                "解析 profile '{}' payload 失败，使用默认值: {e}",
                profile.id
            );
            ProfilePayload::default()
        });
        Self {
            id: profile.id,
            name: profile.name,
            payload,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        }
    }
}

/// 每个分组当前激活的项目 id（未使用项目时为 null）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentProfileIds {
    pub claude: Option<String>,
    pub claude_desktop: Option<String>,
    pub codex: Option<String>,
    pub gemini: Option<String>,
    pub grokbuild: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesResponse {
    pub profiles: Vec<ProfileDto>,
    pub current_ids: CurrentProfileIds,
}

/// Profile 应用完成后的统一收尾：发事件 + 重建托盘菜单
///
/// 只对项目所属分组内的应用发 provider-switched。UI 与托盘两个入口必须
/// 共用此函数，保证事件 payload 形状一致（前端 App.tsx 的
/// provider-switched 监听依赖该形状）。
pub fn emit_profile_apply_events(
    app: &tauri::AppHandle,
    state: &AppState,
    profile_id: &str,
    scopes: &[ProfileScope],
) {
    for scope in scopes {
        for app_type in scope.apps().iter() {
            let app_str = app_type.as_str();
            let (proxy_enabled, auto_failover_enabled) = state.db.get_proxy_flags_sync(app_str);
            let provider_id = crate::settings::get_effective_current_provider(&state.db, app_type)
                .ok()
                .flatten()
                .unwrap_or_default();
            let event_data = serde_json::json!({
                "appType": app_str,
                "proxyEnabled": proxy_enabled,
                "autoFailoverEnabled": auto_failover_enabled,
                "providerId": provider_id,
            });
            if let Err(e) = app.emit("provider-switched", event_data) {
                log::error!("发射 provider-switched 事件失败: {e}");
            }
        }
    }
    let scope_names: Vec<&str> = scopes.iter().map(ProfileScope::as_str).collect();
    let primary_scope = scope_names.first().copied();
    if let Err(e) = app.emit(
        "profile-applied",
        serde_json::json!({
            "profileId": profile_id,
            "scope": primary_scope,
            "scopes": scope_names,
        }),
    ) {
        log::error!("发射 profile-applied 事件失败: {e}");
    }
    crate::tray::refresh_tray_menu(app);
}

/// 在异步运行时完成 Profile 路由状态并发送最终刷新事件。
///
/// 页面与托盘入口共用此函数，确保事件只在 Live 配置、路由服务和数据库状态
/// 全部收敛后发出，前端不会读取到“基础配置已切换、路由尚未恢复”的中间态。
pub async fn finalize_profile_apply(
    app: &tauri::AppHandle,
    state: &AppState,
    profile_id: &str,
    mut result: ProfileApplyResult,
) -> Vec<String> {
    ProfileService::finalize_routing(state, &result.routing_targets, &mut result.warnings).await;
    emit_profile_apply_events(app, state, profile_id, &result.target_scopes);
    result.warnings
}

#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> Result<ProfilesResponse, String> {
    let profiles = ProfileService::list(&state).map_err(|e| e.to_string())?;
    let current_ids = CurrentProfileIds {
        claude: state
            .db
            .get_current_profile_id(ProfileScope::Claude.as_str())
            .map_err(|e| e.to_string())?,
        claude_desktop: state
            .db
            .get_current_profile_id(ProfileScope::ClaudeDesktop.as_str())
            .map_err(|e| e.to_string())?,
        codex: state
            .db
            .get_current_profile_id(ProfileScope::Codex.as_str())
            .map_err(|e| e.to_string())?,
        gemini: state
            .db
            .get_current_profile_id(ProfileScope::Gemini.as_str())
            .map_err(|e| e.to_string())?,
        grokbuild: state
            .db
            .get_current_profile_id(ProfileScope::GrokBuild.as_str())
            .map_err(|e| e.to_string())?,
    };
    Ok(ProfilesResponse {
        profiles: profiles.into_iter().map(ProfileDto::from).collect(),
        current_ids,
    })
}

#[tauri::command]
pub fn create_profile(
    state: State<'_, AppState>,
    name: String,
    scope: String,
) -> Result<ProfileDto, String> {
    let scope = ProfileScope::parse(&scope).map_err(|e| e.to_string())?;
    ProfileService::create(&state, &name, scope)
        .map(ProfileDto::from)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_profile(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    payload: Option<ProfilePayload>,
) -> Result<ProfileDto, String> {
    ProfileService::update(&state, &id, name, payload)
        .map(ProfileDto::from)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    ProfileService::delete(&state, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_current_profile(state: State<'_, AppState>, scope: String) -> Result<(), String> {
    let scope = ProfileScope::parse(&scope).map_err(|e| e.to_string())?;
    state
        .db
        .set_current_profile_id(scope.as_str(), None)
        .map_err(|e| e.to_string())
}

/// 按项目 targets 整体应用 1 个或多个 Agent 的配置快照。
///
/// Provider/MCP/Skills/Prompt 阶段必须在 blocking 线程执行，因为
/// `ProviderService::switch` 内部同步等待每 Agent 切换锁；路由接管阶段需要
/// Tokio 网络运行时，因此基础配置完成后回到 async 命令线程统一最终化。
#[tauri::command]
pub async fn apply_profile(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let apply_app = app.clone();
    let apply_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = apply_app
            .try_state::<AppState>()
            .ok_or_else(|| "应用状态不可用".to_string())?;
        ProfileService::apply(state.inner(), &apply_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("等待组合配置应用任务失败: {e}"))??;

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "应用状态不可用".to_string())?;
    Ok(finalize_profile_apply(&app, state.inner(), &id, result).await)
}
