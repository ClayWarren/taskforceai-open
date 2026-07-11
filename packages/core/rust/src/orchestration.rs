#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrchestrationRole {
    pub name: &'static str,
    pub description: &'static str,
}

pub fn default_orchestration_roles() -> Vec<OrchestrationRole> {
    vec![
        OrchestrationRole {
            name: "Researcher",
            description: "Web search and fact gathering",
        },
        OrchestrationRole {
            name: "Analyst",
            description: "Data analysis and logic",
        },
        OrchestrationRole {
            name: "Skeptic",
            description: "Critique and risk assessment",
        },
        OrchestrationRole {
            name: "Pragmatist",
            description: "Practical application",
        },
    ]
}

pub fn normalize_orchestration_role(role: &str) -> Option<&'static str> {
    let role = role.trim();
    default_orchestration_roles()
        .into_iter()
        .find(|candidate| candidate.name.eq_ignore_ascii_case(role))
        .map(|candidate| candidate.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_roles_are_ordered_product_roles() {
        let roles = default_orchestration_roles();
        assert_eq!(
            roles
                .iter()
                .map(|role| role.name)
                .collect::<Vec<&'static str>>(),
            vec!["Researcher", "Analyst", "Skeptic", "Pragmatist"],
        );
    }

    #[test]
    fn normalize_orchestration_role_accepts_case_and_whitespace() {
        assert_eq!(normalize_orchestration_role("  skeptic "), Some("Skeptic"));
        assert_eq!(normalize_orchestration_role("invalid"), None);
    }
}
