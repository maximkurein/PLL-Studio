// Значения синхронизируются из config/version.json, вручную не править.
// Обновление: python3 tools/update_version.py sync

pub const NAME: &str = "PLL Studio";
pub const VERSION: &str = "0.1.1";
pub const RELEASE_DATE: &str = "08.11.2026";
pub const AUTHOR: &str = "Kurein M N";
pub const LICENSE: &str = "MIT";
pub const REPOSITORY: &str = "https://github.com/maximkurein/PLL-Studio";
pub const MIRROR: &str = "http://100.64.0.12:3000/mxm/PLL-Studio";

pub fn title() -> String {
    format!("{NAME} v{VERSION} · {AUTHOR}")
}

pub fn info() -> serde_json::Value {
    serde_json::json!({
        "name": NAME, "version": VERSION, "release_date": RELEASE_DATE,
        "author": AUTHOR, "license": LICENSE, "repository": REPOSITORY, "mirror": MIRROR,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_package_and_source() {
        assert_eq!(VERSION, env!("CARGO_PKG_VERSION"));
        let source: serde_json::Value = serde_json::from_str(include_str!("../../../config/version.json")).unwrap();
        for key in ["name", "version", "release_date", "author", "license", "repository", "mirror"] {
            assert_eq!(info()[key], source["app_info"][key], "{key}");
        }
        assert_eq!(title(), format!("{} v{} · {}", NAME, VERSION, AUTHOR));
    }
}
