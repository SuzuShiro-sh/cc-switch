//! Skill 分组业务服务。

use std::collections::HashSet;

use chrono::Utc;

use crate::app_config::SkillGroup;
use crate::database::Database;
use crate::error::AppError;

const MAX_GROUP_NAME_CHARS: usize = 80;

pub struct SkillGroupService;

impl SkillGroupService {
    pub fn list(db: &Database) -> Result<Vec<SkillGroup>, AppError> {
        db.get_skill_groups()
    }

    pub fn create(
        db: &Database,
        name: &str,
        skill_ids: Vec<String>,
    ) -> Result<SkillGroup, AppError> {
        let name = Self::validate_name(db, name, None)?;
        let skill_ids = Self::validate_members(db, skill_ids)?;
        let now = Utc::now().timestamp();
        let group = SkillGroup {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            skill_ids,
            created_at: now,
            updated_at: now,
        };
        db.save_skill_group(&group)?;
        log::info!(
            "[SkillGroup] created id={} members={}",
            group.id,
            group.skill_ids.len()
        );
        Ok(group)
    }

    pub fn update(
        db: &Database,
        id: &str,
        name: &str,
        skill_ids: Vec<String>,
    ) -> Result<SkillGroup, AppError> {
        let existing = db
            .get_skill_group(id)?
            .ok_or_else(|| AppError::InvalidInput(format!("Skill group not found: {id}")))?;
        let name = Self::validate_name(db, name, Some(id))?;
        let skill_ids = Self::validate_members(db, skill_ids)?;
        let group = SkillGroup {
            id: existing.id,
            name,
            skill_ids,
            created_at: existing.created_at,
            updated_at: Utc::now().timestamp(),
        };
        db.save_skill_group(&group)?;
        log::info!(
            "[SkillGroup] updated id={} members={}",
            group.id,
            group.skill_ids.len()
        );
        Ok(group)
    }

    pub fn delete(db: &Database, id: &str) -> Result<(), AppError> {
        if !db.delete_skill_group(id)? {
            return Err(AppError::InvalidInput(format!(
                "Skill group not found: {id}"
            )));
        }
        log::info!("[SkillGroup] deleted id={id}");
        Ok(())
    }

    fn validate_name(
        db: &Database,
        raw_name: &str,
        current_id: Option<&str>,
    ) -> Result<String, AppError> {
        let name = raw_name.trim();
        if name.is_empty() {
            return Err(AppError::InvalidInput(
                "Skill group name is empty".to_string(),
            ));
        }
        if name.chars().count() > MAX_GROUP_NAME_CHARS {
            return Err(AppError::InvalidInput(format!(
                "Skill group name exceeds {MAX_GROUP_NAME_CHARS} characters"
            )));
        }
        if db.get_skill_groups()?.iter().any(|group| {
            Some(group.id.as_str()) != current_id && group.name.eq_ignore_ascii_case(name)
        }) {
            return Err(AppError::InvalidInput(format!(
                "Skill group name already exists: {name}"
            )));
        }
        Ok(name.to_string())
    }

    fn validate_members(db: &Database, skill_ids: Vec<String>) -> Result<Vec<String>, AppError> {
        let installed = db.get_all_installed_skills()?;
        let mut seen = HashSet::new();
        let mut normalized = Vec::new();
        let mut missing = Vec::new();
        for skill_id in skill_ids {
            if !seen.insert(skill_id.clone()) {
                continue;
            }
            if installed.contains_key(&skill_id) {
                normalized.push(skill_id);
            } else {
                missing.push(skill_id);
            }
        }
        if !missing.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "Skill group contains missing Skills: {}",
                missing.join(", ")
            )));
        }
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_config::{InstalledSkill, SkillApps};

    fn skill(id: &str) -> InstalledSkill {
        InstalledSkill {
            id: id.to_string(),
            name: id.to_string(),
            description: None,
            directory: id.to_string(),
            repo_owner: None,
            repo_name: None,
            repo_branch: None,
            readme_url: None,
            apps: SkillApps::default(),
            installed_at: 1,
            content_hash: None,
            updated_at: 0,
        }
    }

    #[test]
    fn validates_names_members_and_duplicate_ids() -> Result<(), AppError> {
        let db = Database::memory()?;
        db.save_skill(&skill("s1"))?;

        let group =
            SkillGroupService::create(&db, " Research ", vec!["s1".to_string(), "s1".to_string()])?;
        assert_eq!(group.name, "Research");
        assert_eq!(group.skill_ids, vec!["s1"]);

        assert!(SkillGroupService::create(&db, "research", vec![]).is_err());
        assert!(SkillGroupService::create(&db, "Missing", vec!["ghost".to_string()]).is_err());
        Ok(())
    }
}
