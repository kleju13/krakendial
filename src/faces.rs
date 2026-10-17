//! Faces made in the editor, one JSON file each in %LOCALAPPDATA%\krakenlcd\faces. The page
//! checks every widget when it draws a face; here a face only has to be a small JSON object
//! with a list of widgets, saved under a plain id.

use serde_json::{json, Value};
use std::path::PathBuf;

/// Big enough for a couple of hundred widgets.
pub const MAX_BYTES: usize = 256 * 1024;
const MAX_WIDGETS: usize = 200;

fn dir() -> PathBuf {
    let d = crate::data_dir().join("faces");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Lower-case letters, digits and dashes: nothing that could step outside the folder.
pub fn valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn exists(id: &str) -> bool {
    valid_id(id) && dir().join(format!("{id}.json")).is_file()
}

pub fn get(id: &str) -> Option<Value> {
    if !valid_id(id) {
        return None;
    }
    let s = std::fs::read_to_string(dir().join(format!("{id}.json"))).ok()?;
    serde_json::from_str(&s).ok().filter(Value::is_object)
}

pub fn list() -> Value {
    let mut faces: Vec<Value> = std::fs::read_dir(dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| get(e.file_name().to_str()?.strip_suffix(".json")?))
        .collect();
    faces.sort_by_key(|f| f["name"].as_str().unwrap_or("").to_lowercase());
    Value::Array(faces)
}

/// An id made from the name: "My face!" -> "my-face", then "my-face-2" if that is taken.
fn fresh_id(name: &str) -> String {
    let mut base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    base.truncate(32);
    if base.is_empty() {
        base = "face".into();
    }
    let mut id = base.clone();
    let mut n = 2;
    while exists(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Saves a face, giving it an id from its name when it has none; returns it as saved.
pub fn save(mut face: Value) -> Result<Value, String> {
    if !face.is_object() || !face["widgets"].is_array() {
        return Err("not a face".into());
    }
    if face["widgets"].as_array().map_or(0, Vec::len) > MAX_WIDGETS {
        return Err(format!("more than {MAX_WIDGETS} widgets"));
    }
    let name = face["name"].as_str().unwrap_or("").trim().chars().take(60).collect::<String>();
    let name = if name.is_empty() { "Face".to_string() } else { name };
    let id = match face["id"].as_str() {
        Some(id) if valid_id(id) => id.to_string(),
        _ => fresh_id(&name),
    };
    face["id"] = json!(id);
    face["name"] = json!(name);
    face["version"] = json!(1);
    let body = face.to_string();
    if body.len() > MAX_BYTES {
        return Err("too big".into());
    }
    let path = dir().join(format!("{id}.json"));
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, body).and_then(|_| std::fs::rename(&tmp, &path)).map_err(|e| e.to_string())?;
    Ok(face)
}

pub fn remove(id: &str) {
    if valid_id(id) {
        let _ = std::fs::remove_file(dir().join(format!("{id}.json")));
    }
}

/// `id=<face id>` from a query string.
pub fn query_id(query: &str) -> Option<String> {
    query.split('&').find_map(|kv| kv.strip_prefix("id=")).filter(|id| valid_id(id)).map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_stay_inside_the_folder() {
        assert!(valid_id("my-face-2"));
        for bad in ["", "../x", "a/b", "A", "a.json", "a b", &"x".repeat(41)] {
            assert!(!valid_id(bad), "{bad}");
        }
    }
}
