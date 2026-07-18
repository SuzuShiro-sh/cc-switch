//! Skill 分组数据访问。

use crate::app_config::SkillGroup;
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;

impl Database {
    /// 按名称读取全部 Skill 分组及其有序成员。
    pub fn get_skill_groups(&self) -> Result<Vec<SkillGroup>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut groups = {
            let mut group_stmt = conn
                .prepare(
                    "SELECT id, name, created_at, updated_at
                     FROM skill_groups
                     ORDER BY name COLLATE NOCASE, id",
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            let group_rows = group_stmt
                .query_map([], |row| {
                    Ok(SkillGroup {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        skill_ids: Vec::new(),
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                })
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut groups = Vec::new();
            for row in group_rows {
                groups.push(row.map_err(|e| AppError::Database(e.to_string()))?);
            }
            groups
        };

        let mut member_stmt = conn
            .prepare(
                "SELECT skill_id FROM skill_group_members
                 WHERE group_id = ?1
                 ORDER BY sort_order, skill_id",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        for group in &mut groups {
            let member_rows = member_stmt
                .query_map([&group.id], |row| row.get::<_, String>(0))
                .map_err(|e| AppError::Database(e.to_string()))?;
            for row in member_rows {
                group
                    .skill_ids
                    .push(row.map_err(|e| AppError::Database(e.to_string()))?);
            }
        }
        Ok(groups)
    }

    /// 按 ID 读取单个 Skill 分组。
    pub fn get_skill_group(&self, id: &str) -> Result<Option<SkillGroup>, AppError> {
        Ok(self
            .get_skill_groups()?
            .into_iter()
            .find(|group| group.id == id))
    }

    /// 原子保存分组元数据并替换成员列表。
    pub fn save_skill_group(&self, group: &SkillGroup) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let transaction = conn
            .unchecked_transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        transaction
            .execute(
                "INSERT INTO skill_groups (id, name, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    updated_at = excluded.updated_at",
                params![group.id, group.name, group.created_at, group.updated_at],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        transaction
            .execute(
                "DELETE FROM skill_group_members WHERE group_id = ?1",
                [&group.id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        for (sort_order, skill_id) in group.skill_ids.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO skill_group_members (group_id, skill_id, sort_order)
                     VALUES (?1, ?2, ?3)",
                    params![group.id, skill_id, sort_order as i64],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
        }

        transaction
            .commit()
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 删除分组；成员关系由外键级联删除。
    pub fn delete_skill_group(&self, id: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM skill_groups WHERE id = ?1", [id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
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
    fn skill_group_crud_preserves_member_order_and_cascades() -> Result<(), AppError> {
        let db = Database::memory()?;
        db.save_skill(&skill("s1"))?;
        db.save_skill(&skill("s2"))?;

        let mut group = SkillGroup {
            id: "g1".to_string(),
            name: "Research".to_string(),
            skill_ids: vec!["s2".to_string(), "s1".to_string()],
            created_at: 1,
            updated_at: 1,
        };
        db.save_skill_group(&group)?;
        assert_eq!(db.get_skill_groups()?, vec![group.clone()]);

        let mut updated_skill = skill("s2");
        updated_skill.name = "s2 updated".to_string();
        updated_skill.updated_at = 2;
        db.save_skill(&updated_skill)?;
        assert_eq!(
            db.get_skill_group("g1")?
                .expect("group after Skill update")
                .skill_ids,
            vec!["s2", "s1"]
        );

        group.name = "Research Updated".to_string();
        group.skill_ids = vec!["s1".to_string()];
        group.updated_at = 2;
        db.save_skill_group(&group)?;
        assert_eq!(db.get_skill_group("g1")?, Some(group.clone()));

        db.delete_skill("s1")?;
        let after_skill_delete = db.get_skill_group("g1")?.expect("group remains");
        assert!(after_skill_delete.skill_ids.is_empty());

        assert!(db.delete_skill_group("g1")?);
        assert!(!db.delete_skill_group("g1")?);
        Ok(())
    }
}
