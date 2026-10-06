//! Favorite blocks ("snippets") referenced as `{{name}}` in any query.
//!
//! Rust port of `src/store/snippets.ts` — both must expand identically, since
//! the app (`runBlock`) and the MCP server run the same project SQL.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::notebook::Snippet;

/// Matches a `{{ name }}` favorite-block reference.
static SNIPPET_REF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}").unwrap());

/// Characters a favorite name may NOT contain (complement of `SNIPPET_REF`'s).
static INVALID_NAME_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^A-Za-z0-9_.-]+").unwrap());

/// Trailing `;` (and whitespace) of a snippet body.
static TRAILING_SEMICOLON: LazyLock<Regex> = LazyLock::new(|| Regex::new(r";\s*$").unwrap());

/// Maximum nesting depth of references, as a guard against runaway expansion.
const MAX_DEPTH: usize = 10;

/// Turn a free-form label ("Recent users 2") into a name `{{…}}` can reference
/// ("Recent_users_2"). Returns "" when nothing usable remains.
pub fn to_snippet_name(label: &str) -> String {
    INVALID_NAME_CHARS
        .replace_all(label.trim(), "_")
        .trim_matches('_')
        .to_string()
}

/// Replace `{{name}}` references with the referenced favorite's SQL, wrapped in
/// parentheses so it drops straight into a subquery position. Nested references
/// resolve recursively; unknown and cyclic references are left as written so
/// the database reports a clear error.
pub fn expand_snippets(sql: &str, snippets: &[Snippet]) -> String {
    expand(sql, snippets, &HashSet::new(), 0)
}

fn expand(sql: &str, snippets: &[Snippet], seen: &HashSet<String>, depth: usize) -> String {
    if depth > MAX_DEPTH {
        return sql.to_string();
    }
    SNIPPET_REF
        .replace_all(sql, |caps: &Captures| {
            let whole = caps[0].to_string();
            let name = caps[1].trim();
            if seen.contains(name) {
                return whole; // cycle → leave as written
            }
            let Some(snippet) = snippets.iter().find(|s| s.name == name) else {
                return whole; // unknown → leave as written
            };
            let body = TRAILING_SEMICOLON.replace(snippet.sql.trim(), "");
            let mut inner_seen = seen.clone();
            inner_seen.insert(name.to_string());
            format!("({})", expand(&body, snippets, &inner_seen, depth + 1))
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snippet(name: &str, sql: &str) -> Snippet {
        Snippet {
            id: name.into(),
            name: name.into(),
            sql: sql.into(),
            block_type: "query".into(),
        }
    }

    #[test]
    fn inlines_a_reference_as_a_subquery_without_its_semicolon() {
        let s = [snippet("recent", "SELECT * FROM users;")];
        assert_eq!(
            expand_snippets("SELECT * FROM {{ recent }} r", &s),
            "SELECT * FROM (SELECT * FROM users) r"
        );
    }

    #[test]
    fn resolves_nested_and_leaves_unknown_or_cyclic_intact() {
        let s = [
            snippet("a", "SELECT * FROM {{b}}"),
            snippet("b", "SELECT 1"),
            snippet("c", "{{c}}"),
        ];
        assert_eq!(expand_snippets("{{a}}", &s), "(SELECT * FROM (SELECT 1))");
        assert_eq!(expand_snippets("{{nope}}", &s), "{{nope}}");
        assert_eq!(expand_snippets("{{c}}", &s), "({{c}})");
    }

    #[test]
    fn produces_names_a_reference_can_match() {
        assert_eq!(to_snippet_name("  Query 1 "), "Query_1");
        assert_eq!(to_snippet_name("users/active (FR)"), "users_active_FR");
        assert_eq!(to_snippet_name("a.b-c_d"), "a.b-c_d");
        assert_eq!(to_snippet_name(" ?? "), "");
    }
}
